"""Read structure of reMarkable tablet lines format v6

With help from ddvk's v6 reader, and enum values from remt.

"""

from __future__ import annotations

import logging
import math
import typing as tp
from abc import ABC, abstractmethod
from collections.abc import Iterable, Iterator
from dataclasses import KW_ONLY, dataclass, replace
from uuid import UUID, uuid4

from packaging.version import Version

from . import scene_items as si
from .crdt_sequence import CrdtSequence, CrdtSequenceItem
from .scene_tree import SceneTree
from .tagged_block_common import CrdtId, LwwValue, TagType, UnexpectedBlockError
from .tagged_block_reader import MainBlockInfo, TaggedBlockReader
from .tagged_block_writer import TaggedBlockWriter

_logger = logging.getLogger(__name__)


############################################################
# Top-level block types
############################################################


@dataclass
class Block(ABC):
    BLOCK_TYPE: tp.ClassVar

    # Store any unrecognised data we can't understand
    _: KW_ONLY
    extra_data: bytes = b""

    def version_info(self, writer: TaggedBlockWriter) -> tuple[int, int]:
        """Return (min_version, current_version) to use when writing."""
        return (1, 1)

    def get_block_type(self) -> int:
        """Return block type for this block."""
        return self.BLOCK_TYPE

    @classmethod
    def lookup(cls, block_type: int) -> tp.Optional[tp.Type[Block]]:
        if getattr(cls, "BLOCK_TYPE", None) == block_type:
            return cls
        for subclass in cls.__subclasses__():
            if match := subclass.lookup(block_type):
                return match
        return None

    @classmethod
    def read(self, reader: TaggedBlockReader) -> tp.Optional[Block]:
        """
        Maybe parse a block from the reader stream.
        """
        with reader.read_block() as block_info:
            if block_info is None:
                return

            block_type = Block.lookup(block_info.block_type)
            if block_type:
                try:
                    block = block_type.from_stream(reader)
                except Exception as e:
                    _logger.warning("Error reading block: %s", e)
                    reader.data.data.seek(block_info.offset)
                    data = reader.data.read_bytes(block_info.size)
                    block = UnreadableBlock(str(e), data, block_info)
            else:
                msg = (
                    f"Unknown block type {block_info.block_type}. "
                    f"Skipping {block_info.size} bytes."
                )
                _logger.warning(msg)
                data = reader.data.read_bytes(block_info.size)
                block = UnreadableBlock(msg, data, block_info)

        # Keep any unparsed extra data
        block.extra_data = block_info.extra_data
        return block

    def write(self, writer: TaggedBlockWriter):
        """Write the block header and content to the stream."""
        min_version, current_version = self.version_info(writer)
        with writer.write_block(self.get_block_type(), min_version, current_version):
            self.to_stream(writer)
            # Write any leftover extra data that wasn't parsed
            writer.data.write_bytes(self.extra_data)

    @classmethod
    @abstractmethod
    def from_stream(cls, reader: TaggedBlockReader) -> Block:
        """Read content of block from stream."""
        raise NotImplementedError()

    @abstractmethod
    def to_stream(self, writer: TaggedBlockWriter):
        """Write content of block to stream."""
        raise NotImplementedError()


@dataclass
class UnreadableBlock(Block):
    """Represent a block which could not be read for some reason."""

    error: str
    data: bytes
    info: MainBlockInfo

    def get_block_type(self) -> int:
        return self.info.block_type

    @classmethod
    def from_stream(cls, reader: TaggedBlockReader) -> Block:
        raise NotImplementedError()

    def to_stream(self, writer: TaggedBlockWriter):
        writer.data.write_bytes(self.data)


@dataclass
class SceneInfo(Block):
    BLOCK_TYPE: tp.ClassVar = 0x0D

    def version_info(self, _) -> tuple[int, int]:
        """Return (min_version, current_version) to use when writing."""
        return (0, 1)

    current_layer: LwwValue[CrdtId]
    background_visible: tp.Optional[LwwValue[bool]]
    root_document_visible: tp.Optional[LwwValue[bool]]
    paper_size: tp.Optional[tuple[int, int]]

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> SceneInfo:
        current_layer = stream.read_lww_id(1)
        background_visible = stream.read_lww_bool(2) if stream.bytes_remaining_in_block() > 0 else None
        root_document_visible = stream.read_lww_bool(3) if stream.bytes_remaining_in_block() > 0 else None
        paper_size = stream.read_int_pair(5) if stream.bytes_remaining_in_block() > 0 else None

        return SceneInfo(current_layer=current_layer,
                         background_visible=background_visible,
                         root_document_visible=root_document_visible,
                         paper_size=paper_size)

    def to_stream(self, writer: TaggedBlockWriter):
        writer.write_lww_id(1, self.current_layer)
        if self.background_visible:
            writer.write_lww_bool(2, self.background_visible)
        if self.root_document_visible:
            writer.write_lww_bool(3, self.root_document_visible)
        if self.paper_size:
            writer.write_int_pair(5, self.paper_size)


@dataclass
class AuthorIdsBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x09

    author_uuids: dict[int, UUID]

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> AuthorIdsBlock:
        _logger.debug("Reading %s", cls.__name__)
        num_subblocks = stream.data.read_varuint()
        author_ids = {}
        for _ in range(num_subblocks):
            with stream.read_subblock(0):
                uuid_length = stream.data.read_varuint()
                if uuid_length != 16:
                    raise ValueError("Expected UUID length to be 16 bytes")
                uuid = UUID(bytes_le=stream.data.read_bytes(uuid_length))
                author_id = stream.data.read_uint16()
                author_ids[author_id] = uuid
        return AuthorIdsBlock(author_ids)

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        num_subblocks = len(self.author_uuids)
        writer.data.write_varuint(num_subblocks)
        for author_id, uuid in self.author_uuids.items():
            with writer.write_subblock(0):
                writer.data.write_varuint(len(uuid.bytes_le))
                writer.data.write_bytes(uuid.bytes_le)
                writer.data.write_uint16(author_id)


@dataclass
class MigrationInfoBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x00

    migration_id: CrdtId
    is_device: bool
    _unknown: bool = False

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> MigrationInfoBlock:
        "Parse migration info"
        _logger.debug("Reading %s", cls.__name__)
        migration_id = stream.read_id(1)
        is_device = stream.read_bool(2)
        if stream.bytes_remaining_in_block():
            unknown = stream.read_bool(3)
        else:
            unknown = False
        return MigrationInfoBlock(migration_id, is_device, unknown)

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        version = writer.options.get("version", Version("9.9.9"))
        writer.write_id(1, self.migration_id)
        writer.write_bool(2, self.is_device)
        if version >= Version("3.2.2"):
            writer.write_bool(3, self._unknown)


@dataclass
class TreeNodeBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x02

    def version_info(self, writer: TaggedBlockWriter) -> tuple[int, int]:
        """Return (min_version, current_version) to use when writing."""
        version = writer.options.get("version", Version("9999"))
        # XXX this is a guess about which version this changed in
        return (1, 2) if (version >= Version("3.4")) else (1, 1)

    group: si.Group

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> TreeNodeBlock:
        "Parse tree node block."
        _logger.debug("Reading %s", cls.__name__)

        group = si.Group(
            node_id=stream.read_id(1),
            label=stream.read_lww_string(2),
            visible=stream.read_lww_bool(3),
        )

        if stream.bytes_remaining_in_block() > 0:
            group.anchor_id = stream.read_lww_id(7)
            group.anchor_type = stream.read_lww_byte(8)
            group.anchor_threshold = stream.read_lww_float(9)
            group.anchor_origin_x = stream.read_lww_float(10)

        return cls(group)

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        group = self.group
        writer.write_id(1, group.node_id)
        writer.write_lww_string(2, group.label)
        writer.write_lww_bool(3, group.visible)
        if group.anchor_id is not None:
            assert (
                group.anchor_type is not None
                and group.anchor_threshold is not None
                and group.anchor_origin_x is not None
            )
            writer.write_lww_id(7, group.anchor_id)
            writer.write_lww_byte(8, group.anchor_type)
            writer.write_lww_float(9, group.anchor_threshold)
            writer.write_lww_float(10, group.anchor_origin_x)


@dataclass
class PageInfoBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x0A

    def version_info(self, _) -> tuple[int, int]:
        """Return (min_version, current_version) to use when writing."""
        return (0, 1)

    loads_count: int
    merges_count: int
    text_chars_count: int
    text_lines_count: int
    type_folio_use_count: int = 0

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> PageInfoBlock:
        "Parse page info block"
        _logger.debug("Reading %s", cls.__name__)
        info = PageInfoBlock(
            loads_count=stream.read_int(1),
            merges_count=stream.read_int(2),
            text_chars_count=stream.read_int(3),
            text_lines_count=stream.read_int(4),
        )
        if stream.bytes_remaining_in_block():
            info.type_folio_use_count = stream.read_int(5)
        return info

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        writer.write_int(1, self.loads_count)
        writer.write_int(2, self.merges_count)
        writer.write_int(3, self.text_chars_count)
        writer.write_int(4, self.text_lines_count)
        version = writer.options.get("version", Version("9999"))
        if version >= Version("3.2.2"):
            writer.write_int(5, self.type_folio_use_count)


@dataclass
class SceneTreeBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x01

    tree_id: CrdtId
    node_id: CrdtId
    is_update: bool
    parent_id: CrdtId

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> SceneTreeBlock:
        "Parse scene tree block"
        _logger.debug("Reading %s", cls.__name__)

        tree_id = stream.read_id(1)
        node_id = stream.read_id(2)
        is_update = stream.read_bool(3)
        with stream.read_subblock(4):
            parent_id = stream.read_id(1)

        return SceneTreeBlock(tree_id, node_id, is_update, parent_id)

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        writer.write_id(1, self.tree_id)
        writer.write_id(2, self.node_id)
        writer.write_bool(3, self.is_update)
        with writer.write_subblock(4):
            writer.write_id(1, self.parent_id)


def point_from_stream(stream: TaggedBlockReader, version: int = 2) -> si.Point:
    if version not in (1, 2):
        raise ValueError("Unknown version %s" % version)
    d = stream.data
    x = d.read_float32()
    y = d.read_float32()
    if version == 1:
        speed = d.read_float32() * 4
        direction = 255 * d.read_float32() / (math.pi * 2)
        width = int(round(d.read_float32() * 4))
        pressure = d.read_float32() * 255
    else:
        speed = d.read_uint16()
        width = d.read_uint16()
        direction = d.read_uint8()
        pressure = d.read_uint8()
    return si.Point(x, y, speed, direction, width, pressure)


def point_serialized_size(version: int = 2) -> int:
    if version == 1:
        return 0x18
    elif version == 2:
        return 0x0E
    else:
        raise ValueError("Unknown version %s" % version)


def point_to_stream(point: si.Point, writer: TaggedBlockWriter, version: int = 2):
    if version not in (1, 2):
        raise ValueError("Unknown version %s" % version)
    d = writer.data
    d.write_float32(point.x)
    d.write_float32(point.y)
    _logger.debug("Writing Point v%d: %s", version, point)
    if version == 1:
        d.write_float32(point.speed / 4)
        d.write_float32(point.direction * (2 * math.pi) / 255)
        d.write_float32(point.width / 4)
        d.write_float32(point.pressure / 255)
    else:
        d.write_uint16(int(point.speed))
        d.write_uint16(int(point.width))
        d.write_uint8(int(point.direction))
        d.write_uint8(int(point.pressure))


def line_from_stream(stream: TaggedBlockReader, version: int = 2) -> si.Line:
    _logger.debug("Reading Line version %d", version)
    tool_id = stream.read_int(1)
    tool = si.Pen(tool_id)
    color_id = stream.read_int(2)
    color = si.PenColor(color_id)
    thickness_scale = stream.read_double(3)
    starting_length = stream.read_float(4)
    with stream.read_subblock(5) as block_info:
        data_length = block_info.size
        point_size = point_serialized_size(version)
        if data_length % point_size != 0:
            raise ValueError(
                "Point data size mismatch: %d is not multiple of point_size"
                % data_length
            )
        num_points = data_length // point_size
        points = [point_from_stream(stream, version=version) for _ in range(num_points)]

    # XXX unused
    timestamp = stream.read_id(6)

    if stream.bytes_remaining_in_block() >= 3:
        try:
            move_id = stream.read_id(7)
        except UnexpectedBlockError as _:
            move_id = None
    else:
        move_id = None

    color_rgba = stream.read_color_optional(8)

    return si.Line(color, tool, points, thickness_scale, starting_length, move_id, color_rgba)


def line_to_stream(line: si.Line, writer: TaggedBlockWriter, version: int = 2):
    _logger.debug("Writing Line version %d", version)
    writer.write_int(1, line.tool)
    writer.write_int(2, line.color)
    writer.write_double(3, line.thickness_scale)
    writer.write_float(4, line.starting_length)
    with writer.write_subblock(5):
        for point in line.points:
            point_to_stream(point, writer, version)

    # XXX didn't save
    timestamp = CrdtId(0, 1)
    writer.write_id(6, timestamp)
    if line.move_id is not None:
        writer.write_id(7, line.move_id)
    if line.color_rgba is not None:
        writer.write_color(8, line.color_rgba)


@dataclass
class SceneItemBlock(Block):
    parent_id: CrdtId
    item: CrdtSequenceItem
    extra_value_data: bytes = b""

    ITEM_TYPE: tp.ClassVar[int] = 0

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> SceneItemBlock:
        "Group item block?"
        _logger.debug("Reading %s", cls.__name__)

        assert stream.current_block
        block_type = stream.current_block.block_type
        if block_type == SceneGlyphItemBlock.BLOCK_TYPE:
            subclass = SceneGlyphItemBlock
        elif block_type == SceneGroupItemBlock.BLOCK_TYPE:
            subclass = SceneGroupItemBlock
        elif block_type == SceneLineItemBlock.BLOCK_TYPE:
            subclass = SceneLineItemBlock
        elif block_type == SceneTextItemBlock.BLOCK_TYPE:
            subclass = SceneTextItemBlock
        elif block_type == SceneTombstoneItemBlock.BLOCK_TYPE:
            subclass = SceneTombstoneItemBlock
        else:
            raise ValueError(
                "unknown scene type %d in %s" % (block_type, stream.current_block)
            )

        parent_id = stream.read_id(1)
        item_id = stream.read_id(2)
        left_id = stream.read_id(3)
        right_id = stream.read_id(4)
        deleted_length = stream.read_int(5)

        if stream.has_subblock(6):
            with stream.read_subblock(6) as block_info:
                item_type = stream.data.read_uint8()
                assert item_type == subclass.ITEM_TYPE
                value = subclass.value_from_stream(stream)
            # Keep known extra data from within the value subblock
            extra_value_data = block_info.extra_data
        else:
            value = None
            extra_value_data = b""

        return subclass(
            parent_id,
            CrdtSequenceItem(item_id, left_id, right_id, deleted_length, value),
            extra_value_data=extra_value_data,
        )

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        writer.write_id(1, self.parent_id)
        writer.write_id(2, self.item.item_id)
        writer.write_id(3, self.item.left_id)
        writer.write_id(4, self.item.right_id)
        writer.write_int(5, self.item.deleted_length)

        if self.item.value is not None:
            with writer.write_subblock(6):
                writer.data.write_uint8(self.ITEM_TYPE)
                self.value_to_stream(writer, self.item.value)

                writer.data.write_bytes(self.extra_value_data)

    @classmethod
    @abstractmethod
    def value_from_stream(cls, reader: TaggedBlockReader) -> tp.Any:
        """Read the specific content of this block"""
        raise NotImplementedError()

    @abstractmethod
    def value_to_stream(self, writer: TaggedBlockWriter, value: tp.Any):
        """Write the specific content of this block"""
        raise NotImplementedError()


class SceneTombstoneItemBlock(SceneItemBlock):
    BLOCK_TYPE: tp.ClassVar = 0x08

    @classmethod
    def value_from_stream(cls, reader: TaggedBlockReader):
        pass

    def value_to_stream(self, writer: TaggedBlockWriter, value):
        pass


class SceneGlyphItemBlock(SceneItemBlock):
    BLOCK_TYPE: tp.ClassVar = 0x03
    ITEM_TYPE: tp.ClassVar = 0x01

    @classmethod
    def value_from_stream(cls, reader: TaggedBlockReader):
        start = reader.read_int_optional(2)
        length = reader.read_int_optional(3)

        color_id = reader.read_int(4)
        color = si.PenColor(color_id)
        text = reader.read_string(5)

        if length is None:
            length = len(text)

        with reader.read_subblock(6):
            num_rects = reader.data.read_varuint()
            rectangles = [
                si.Rectangle(*[reader.data.read_float64() for _ in range(4)])
                for _ in range(num_rects)
            ]

        color_rgba = reader.read_color_optional(10)

        return si.GlyphRange(start, length, text, color, rectangles, color_rgba)

    def value_to_stream(self, writer: TaggedBlockWriter, item):
        if item.start is not None:
            writer.write_int(2, item.start)
            writer.write_int(3, item.length)
        writer.write_int(4, item.color)
        writer.write_string(5, item.text)
        with writer.write_subblock(6):
            writer.data.write_varuint(len(item.rectangles))
            for rect in item.rectangles:
                writer.data.write_float64(rect.x)
                writer.data.write_float64(rect.y)
                writer.data.write_float64(rect.w)
                writer.data.write_float64(rect.h)
        if item.color_rgba is not None:
            writer.write_color(10, item.color_rgba)


class SceneGroupItemBlock(SceneItemBlock):
    BLOCK_TYPE: tp.ClassVar = 0x04
    ITEM_TYPE: tp.ClassVar = 0x02

    @classmethod
    def value_from_stream(cls, reader: TaggedBlockReader) -> CrdtId:
        # XXX don't know what this means
        value = reader.read_id(2)
        return value

    def value_to_stream(self, writer: TaggedBlockWriter, value: CrdtId):
        writer.write_id(2, value)


class SceneLineItemBlock(SceneItemBlock):
    BLOCK_TYPE: tp.ClassVar = 0x05
    ITEM_TYPE: tp.ClassVar = 0x03

    def version_info(self, writer: TaggedBlockWriter) -> tuple[int, int]:
        """Return (min_version, current_version) to use when writing."""
        version = writer.options.get("version", Version("9999"))
        return (2, 2) if (version > Version("3.0")) else (1, 1)

    @classmethod
    def value_from_stream(cls, reader: TaggedBlockReader) -> si.Line:
        assert reader.current_block is not None
        version = reader.current_block.current_version
        value = line_from_stream(reader, version)
        return value

    def value_to_stream(self, writer: TaggedBlockWriter, value: si.Line):
        version = writer.options.get("version", Version("9999"))
        line_version = 2 if (version > Version("3.0")) else 1
        line_to_stream(value, writer, version=line_version)


class SceneTextItemBlock(SceneItemBlock):
    BLOCK_TYPE: tp.ClassVar = 0x06
    ITEM_TYPE: tp.ClassVar = 0x05

    @classmethod
    def value_from_stream(cls, reader: TaggedBlockReader) -> tp.Any:
        return None

    def value_to_stream(self, writer: TaggedBlockWriter, value):
        pass


def text_item_from_stream(stream: TaggedBlockReader):
    with stream.read_subblock(0):
        item_id = stream.read_id(2)
        left_id = stream.read_id(3)
        right_id = stream.read_id(4)
        deleted_length = stream.read_int(5)

        if stream.has_subblock(6):
            text, fmt = stream.read_string_with_format(6)
            if fmt is not None:
                if text:
                    _logger.error(
                        "Unhandled combined text and format: %s, %s", text, fmt
                    )
                value = fmt
            else:
                value = text
        else:
            value = ""

    return CrdtSequenceItem(item_id, left_id, right_id, deleted_length, value)


def text_item_to_stream(item, writer: TaggedBlockWriter):
    with writer.write_subblock(0):
        writer.write_id(2, item.item_id)
        writer.write_id(3, item.left_id)
        writer.write_id(4, item.right_id)
        writer.write_int(5, item.deleted_length)

        if item.value:
            if isinstance(item.value, str):
                writer.write_string(6, item.value)
            elif isinstance(item.value, int):
                writer.write_string_with_format(6, "", item.value)


def text_format_from_stream(stream: TaggedBlockReader):
    char_id = stream.data.read_crdt_id()
    timestamp = stream.read_id(1)

    with stream.read_subblock(2):
        c = stream.data.read_uint8()
        assert c == 17
        format_code = stream.data.read_uint8()
        try:
            format_type = si.ParagraphStyle(format_code)
        except ValueError:
            _logger.warning("Unrecognised text format code %d.", format_code)
            format_type = si.ParagraphStyle.PLAIN  # fallback

    return (char_id, LwwValue(timestamp, format_type))


def text_format_to_stream(char_id, value, writer: TaggedBlockWriter):
    format_type = value.value

    writer.data.write_crdt_id(char_id)
    writer.write_id(1, value.timestamp)
    with writer.write_subblock(2):
        c = 17
        writer.data.write_uint8(c)
        writer.data.write_uint8(format_type)


@dataclass
class RootTextBlock(Block):
    BLOCK_TYPE: tp.ClassVar = 0x07

    block_id: CrdtId
    value: si.Text

    @classmethod
    def from_stream(cls, stream: TaggedBlockReader) -> RootTextBlock:
        "Parse root text block."
        _logger.debug("Reading %s", cls.__name__)

        block_id = stream.read_id(1)
        assert block_id == CrdtId(0, 0)

        with stream.read_subblock(2):

            # Text items
            with stream.read_subblock(1):
                with stream.read_subblock(1):
                    num_subblocks = stream.data.read_varuint()
                    text_items = [
                        text_item_from_stream(stream) for _ in range(num_subblocks)
                    ]

            # Formatting
            with stream.read_subblock(2):
                with stream.read_subblock(1):
                    num_subblocks = stream.data.read_varuint()
                    text_formats = dict(
                        text_format_from_stream(stream) for _ in range(num_subblocks)
                    )

        # Last section
        with stream.read_subblock(3):
            pos_x = stream.data.read_float64()
            pos_y = stream.data.read_float64()

        # "width" from ddvk
        width = stream.read_float(4)

        value = si.Text(
            items=CrdtSequence(text_items),
            styles=text_formats,
            pos_x=pos_x,
            pos_y=pos_y,
            width=width,
        )
        return RootTextBlock(block_id, value)

    def to_stream(self, writer: TaggedBlockWriter):
        _logger.debug("Writing %s", type(self).__name__)
        writer.write_id(1, self.block_id)

        with writer.write_subblock(2):

            # Text items
            text_items = self.value.items.sequence_items()
            with writer.write_subblock(1):
                with writer.write_subblock(1):
                    writer.data.write_varuint(len(text_items))
                    for item in text_items:
                        text_item_to_stream(item, writer)

            # Formatting
            text_formats = self.value.styles
            with writer.write_subblock(2):
                with writer.write_subblock(1):
                    writer.data.write_varuint(len(text_formats))
                    for key, item in text_formats.items():
                        text_format_to_stream(key, item, writer)

        # Last section
        with writer.write_subblock(3):
            writer.data.write_float64(self.value.pos_x)
            writer.data.write_float64(self.value.pos_y)

        # "width" from ddvk
        writer.write_float(4, self.value.width)


## Functions to read and write streams of blocks


def _read_blocks(stream: TaggedBlockReader) -> Iterator[Block]:
    """
    Parse blocks from reMarkable v6 file.
    """
    while True:
        maybe_block = Block.read(stream)
        if maybe_block:
            yield maybe_block
        else:
            # no more blocks
            return


def read_blocks(data: tp.BinaryIO) -> Iterator[Block]:
    """
    Parse reMarkable file and return iterator of document items.

    :param data: reMarkable file data.
    """
    stream = TaggedBlockReader(data)
    stream.read_header()
    yield from _read_blocks(stream)


def write_blocks(
    data: tp.BinaryIO, blocks: Iterable[Block], options: tp.Optional[dict] = None
):
    """
    Write blocks to file.
    """
    if options is not None and "version" in options:
        options["version"] = Version(options["version"])
    stream = TaggedBlockWriter(data, options=options)
    stream.write_header()
    for block in blocks:
        block.write(stream)


def build_tree(tree: SceneTree, blocks: Iterable[Block]):
    """Read `blocks` and add contents to `tree`."""
    for b in blocks:
        if isinstance(b, SceneTreeBlock):
            tree.add_node(b.tree_id, parent_id=b.parent_id)
        elif isinstance(b, TreeNodeBlock):
            if b.group.node_id not in tree:
                raise ValueError(
                    "Node does not exist for TreeNodeBlock: %s" % b.group.node_id
                )
            node = tree[b.group.node_id]
            node.label = b.group.label
            node.visible = b.group.visible
            node.anchor_id = b.group.anchor_id
            node.anchor_type = b.group.anchor_type
            node.anchor_threshold = b.group.anchor_threshold
            node.anchor_origin_x = b.group.anchor_origin_x
        elif isinstance(b, SceneGroupItemBlock):
            node_id = b.item.value
            if node_id is None:
                continue
            if node_id not in tree:
                raise ValueError(
                    "Node does not exist for SceneGroupItemBlock: %s" % node_id
                )
            item = replace(b.item, value=tree[node_id])
            tree.add_item(item, b.parent_id)
        elif isinstance(b, (SceneLineItemBlock, SceneGlyphItemBlock)):
            tree.add_item(b.item, b.parent_id)
        elif isinstance(b, SceneInfo):
            tree.scene_info = b
        elif isinstance(b, RootTextBlock):
            if tree.root_text is not None:
                _logger.error(
                    "Overwriting root text\n  Old: %s\n  New: %s",
                    tree.root_text,
                    b.value,
                )
            tree.root_text = b.value

    pass


def read_tree(data: tp.BinaryIO) -> SceneTree:
    """
    Parse reMarkable file and return `SceneTree`.

    :param data: reMarkable file data.
    """
    tree = SceneTree()
    build_tree(tree, read_blocks(data))
    return tree
