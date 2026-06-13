/* ============================================================
 * RM v6 writer — from-scratch implementation of the reMarkable
 * .lines v6 stroke format, plus a store-only ZIP packer for .rmdoc.
 * Validated byte-for-byte against rmscene (the reference
 * implementation built from real device files).
 * Works in browser and Node (UMD-ish).
 * ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RMW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HEADER = "reMarkable .lines file, version=6          "; // 43 bytes

  const TAG = { ID: 0xf, LEN4: 0xc, BYTE8: 0x8, BYTE4: 0x4, BYTE1: 0x1 };

  // Pen tool ids (v6)
  const PEN = {
    PAINTBRUSH: 12,
    PENCIL: 14,
    BALLPOINT: 15,
    MARKER: 16,
    FINELINER: 17,
    HIGHLIGHTER: 18,
    CALLIGRAPHY: 21,
    SHADER: 23,
    MECH_PENCIL: 13,
  };

  // Color index values (v6) with sRGB reference for matching/preview
  const COLORS = [
    { id: 0, name: "Black", rgb: [0, 0, 0] },
    { id: 1, name: "Gray", rgb: [125, 125, 125] },
    { id: 2, name: "White", rgb: [255, 255, 255] },
    { id: 3, name: "Yellow", rgb: [255, 255, 0] },
    { id: 4, name: "Green", rgb: [0, 110, 0] },
    { id: 5, name: "Pink", rgb: [255, 50, 110] },
    { id: 6, name: "Blue", rgb: [0, 98, 204] },
    { id: 7, name: "Red", rgb: [217, 7, 7] },
    { id: 10, name: "Green 2", rgb: [145, 218, 113] },
    { id: 11, name: "Cyan", rgb: [116, 210, 232] },
    { id: 12, name: "Magenta", rgb: [192, 127, 210] },
    { id: 13, name: "Yellow 2", rgb: [250, 231, 25] },
  ];

  const DEVICES = {
    paperpro: { name: "Paper Pro", width: 1620, height: 2160, color: true },
    move: { name: "Paper Pro Move", width: 954, height: 1696, color: true },
    rm2: { name: "reMarkable 2", width: 1404, height: 1872, color: false },
    pure: { name: "Paper Pure", width: 1404, height: 1872, color: false },
  };

  /* ---------------- byte writer ---------------- */
  class ByteWriter {
    constructor() {
      this.buf = new Uint8Array(1024);
      this.len = 0;
      this.dv = new DataView(this.buf.buffer);
    }
    _ensure(n) {
      if (this.len + n > this.buf.length) {
        const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
        nb.set(this.buf.subarray(0, this.len));
        this.buf = nb;
        this.dv = new DataView(nb.buffer);
      }
    }
    u8(v) { this._ensure(1); this.buf[this.len++] = v & 0xff; }
    bool(v) { this.u8(v ? 1 : 0); }
    u16(v) { this._ensure(2); this.dv.setUint16(this.len, v, true); this.len += 2; }
    u32(v) { this._ensure(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; }
    f32(v) { this._ensure(4); this.dv.setFloat32(this.len, v, true); this.len += 4; }
    f64(v) { this._ensure(8); this.dv.setFloat64(this.len, v, true); this.len += 8; }
    bytes(b) { this._ensure(b.length); this.buf.set(b, this.len); this.len += b.length; }
    ascii(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
    varuint(v) {
      if (v < 0) throw new Error("varuint negative");
      do {
        let b = v & 0x7f;
        v = Math.floor(v / 128);
        if (v) b |= 0x80;
        this.u8(b);
      } while (v);
    }
    tag(index, type) { this.varuint((index << 4) | type); }
    crdtId(id) { this.u8(id[0]); this.varuint(id[1]); }

    // tagged values
    tId(index, id) { this.tag(index, TAG.ID); this.crdtId(id); }
    tBool(index, v) { this.tag(index, TAG.BYTE1); this.bool(v); }
    tByte(index, v) { this.tag(index, TAG.BYTE1); this.u8(v); }
    tInt(index, v) { this.tag(index, TAG.BYTE4); this.u32(v); }
    tFloat(index, v) { this.tag(index, TAG.BYTE4); this.f32(v); }
    tDouble(index, v) { this.tag(index, TAG.BYTE8); this.f64(v); }

    subblock(index, fn) {
      const inner = new ByteWriter();
      fn(inner);
      this.tag(index, TAG.LEN4);
      this.u32(inner.len);
      this.bytes(inner.toBytes());
    }
    block(blockType, minVersion, currentVersion, fn) {
      const inner = new ByteWriter();
      fn(inner);
      this.u32(inner.len);
      this.u8(0);
      this.u8(minVersion);
      this.u8(currentVersion);
      this.u8(blockType);
      this.bytes(inner.toBytes());
    }
    lwwId(index, ts, id) {
      this.subblock(index, (w) => { w.tId(1, ts); w.tId(2, id); });
    }
    lwwBool(index, ts, v) {
      this.subblock(index, (w) => { w.tId(1, ts); w.tBool(2, v); });
    }
    lwwString(index, ts, s) {
      this.subblock(index, (w) => { w.tId(1, ts); w.tString(2, s); });
    }
    tString(index, s) {
      this.subblock(index, (w) => {
        const b = utf8(s);
        w.varuint(b.length);
        w.bool(true);
        w.bytes(b);
      });
    }
    intPair(index, a, b) {
      this.subblock(index, (w) => { w.u32(a); w.u32(b); });
    }
    toBytes() { return this.buf.subarray(0, this.len); }
  }

  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, "utf8"));
  }

  /* ---------------- UUID helpers ---------------- */
  function uuid4() {
    const b = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function uuidToBytesLE(u) {
    const h = u.replace(/-/g, "");
    const b = new Uint8Array(16);
    for (let i = 0; i < 16; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    // bytes_le: first 3 fields little-endian
    return Uint8Array.from([
      b[3], b[2], b[1], b[0],
      b[5], b[4],
      b[7], b[6],
      b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
    ]);
  }

  /* ---------------- .rm page builder ----------------
   * strokes: [{ tool, color, thicknessScale, points: [{x,y,speed,width,direction,pressure}] }]
   * Coordinates: x centred on 0 (page width w -> x in [-w/2, w/2]), y from 0 (top).
   * opts: { paperSize: [w,h], authorUuid }
   */
  function buildRmPage(strokes, opts) {
    opts = opts || {};
    const authorUuid = opts.authorUuid || uuid4();
    const w = new ByteWriter();
    w.ascii(HEADER);

    // AuthorIdsBlock (0x09)
    w.block(0x09, 1, 1, (b) => {
      b.varuint(1);
      b.subblock(0, (s) => {
        s.varuint(16);
        s.bytes(uuidToBytesLE(authorUuid));
        s.u16(1);
      });
    });

    // MigrationInfoBlock (0x00)
    w.block(0x00, 1, 1, (b) => {
      b.tId(1, [1, 1]);
      b.tBool(2, true);
      b.tBool(3, false);
    });

    // PageInfoBlock (0x0A)
    w.block(0x0a, 0, 1, (b) => {
      b.tInt(1, 1); // loads
      b.tInt(2, 0); // merges
      b.tInt(3, 0); // text chars
      b.tInt(4, 0); // text lines
      b.tInt(5, 0); // type folio
    });

    // Layers. Layer k uses CrdtIds: node (0, 11+3k), label ts (0, 12+3k),
    // attach item (0, 13+3k). With a single layer this reproduces the
    // device-validated single-layer byte layout exactly.
    const layers = opts.layers && opts.layers.length ? opts.layers : ["Layer 1"];
    const layerNode = (k) => [0, 11 + 3 * k];

    // SceneTreeBlock (0x01) per layer - layer node under root (0,1)
    for (let k = 0; k < layers.length; k++) {
      w.block(0x01, 1, 1, (b) => {
        b.tId(1, layerNode(k));
        b.tId(2, [0, 0]);
        b.tBool(3, true);
        b.subblock(4, (s) => s.tId(1, [0, 1]));
      });
    }

    // TreeNodeBlock (0x02) - root group
    w.block(0x02, 1, 2, (b) => {
      b.tId(1, [0, 1]);
      b.lwwString(2, [0, 0], "");
      b.lwwBool(3, [0, 0], true);
    });

    // TreeNodeBlock per layer
    for (let k = 0; k < layers.length; k++) {
      w.block(0x02, 1, 2, (b) => {
        b.tId(1, layerNode(k));
        b.lwwString(2, [0, 12 + 3 * k], layers[k]);
        b.lwwBool(3, [0, 0], true);
      });
    }

    // SceneGroupItemBlock (0x04) per layer - attach to root.
    // Sequence order (ascending part2) = bottom-to-top: layer 0 is the bottom.
    for (let k = 0; k < layers.length; k++) {
      w.block(0x04, 1, 1, (b) => {
        b.tId(1, [0, 1]);
        b.tId(2, [0, 13 + 3 * k]);
        b.tId(3, [0, 0]);
        b.tId(4, [0, 0]);
        b.tInt(5, 0);
        b.subblock(6, (s) => {
          s.u8(2); // item type: group reference
          s.tId(2, layerNode(k));
        });
      });
    }

    // SceneLineItemBlocks (0x05), version 2. stroke.layer picks the layer (default 0).
    let seq = 17 + 3 * layers.length; // clear of all layer ids; equals 20 for a single layer
    for (const st of strokes) {
      const itemId = [1, seq++];
      const parent = layerNode(Math.min(st.layer || 0, layers.length - 1));
      w.block(0x05, 2, 2, (b) => {
        b.tId(1, parent);
        b.tId(2, itemId);
        b.tId(3, [0, 0]);
        b.tId(4, [0, 0]);
        b.tInt(5, 0);
        b.subblock(6, (s) => {
          s.u8(3); // item type: line
          s.tInt(1, st.tool);
          s.tInt(2, st.color);
          s.tDouble(3, st.thicknessScale);
          s.tFloat(4, 0.0); // starting length
          s.subblock(5, (p) => {
            for (const pt of st.points) {
              p.f32(pt.x);
              p.f32(pt.y);
              p.u16(pt.speed != null ? pt.speed : 4);
              p.u16(pt.width);
              p.u8(pt.direction != null ? pt.direction : 0);
              p.u8(pt.pressure != null ? pt.pressure : 204);
            }
          });
          s.tId(6, [0, 1]); // timestamp
        });
      });
    }

    // SceneInfo (0x0D) — current layer = topmost (where the user lands to write)
    w.block(0x0d, 0, 1, (b) => {
      b.lwwId(1, [0, 254], layerNode(layers.length - 1));
      b.lwwBool(2, [0, 255], true);
      b.lwwBool(3, [0, 256], true);
      if (opts.paperSize) b.intPair(5, opts.paperSize[0], opts.paperSize[1]);
    });

    return w.toBytes().slice();
  }

  /* ---------------- minimal ZIP (store) ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function buildZip(entries) {
    // entries: [{name, data(Uint8Array)}]
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime =
      ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate =
      ((((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) &
      0xffff;
    for (const e of entries) {
      const nameB = utf8(e.name);
      const crc = crc32(e.data);
      const lh = new ByteWriter();
      lh.u32(0x04034b50);
      lh.u16(20); lh.u16(0); lh.u16(0); // version, flags, method=store
      lh.u16(dosTime); lh.u16(dosDate);
      lh.u32(crc); lh.u32(e.data.length); lh.u32(e.data.length);
      lh.u16(nameB.length); lh.u16(0);
      lh.bytes(nameB);
      chunks.push(lh.toBytes().slice(), e.data);
      const ch = new ByteWriter();
      ch.u32(0x02014b50);
      ch.u16(20); ch.u16(20); ch.u16(0); ch.u16(0);
      ch.u16(dosTime); ch.u16(dosDate);
      ch.u32(crc); ch.u32(e.data.length); ch.u32(e.data.length);
      ch.u16(nameB.length); ch.u16(0); ch.u16(0);
      ch.u16(0); ch.u16(0); ch.u32(0); ch.u32(offset);
      ch.bytes(nameB);
      central.push(ch.toBytes().slice());
      offset += 30 + nameB.length + e.data.length;
    }
    let centralSize = 0;
    for (const c of central) centralSize += c.length;
    const eocd = new ByteWriter();
    eocd.u32(0x06054b50);
    eocd.u16(0); eocd.u16(0);
    eocd.u16(entries.length); eocd.u16(entries.length);
    eocd.u32(centralSize); eocd.u32(offset);
    eocd.u16(0);
    const totalLen = offset + centralSize + eocd.len;
    const out = new Uint8Array(totalLen);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(eocd.toBytes(), p);
    return out;
  }

  /* ---------------- .rmdoc builder ----------------
   * pages: [{ strokes, pdfPage? }] ; opts: { visibleName, device, layers,
   *   pdf?: { bytes: Uint8Array } }  — when pdf is given, exports a PDF-backed
   * document (fileType "pdf"): the PDF renders as page backgrounds and the ink
   * sits on top. Ink coordinate convention for PDF pages (mirrors commercial
   * packs + device legacy): PDF page width maps to 1404 ink units, x centred,
   * y from top; SceneInfo paper_size = (1404, 1872).
   */
  function buildRmdoc(pages, opts) {
    opts = opts || {};
    const device = DEVICES[opts.device || "paperpro"];
    const isPdf = !!(opts.pdf && opts.pdf.bytes);
    const docUuid = uuid4();
    const authorUuid = uuid4();
    const pageUuids = pages.map(() => uuid4());
    const nowMs = Date.now().toString();

    const paperSize = isPdf ? [1404, 1872] : [device.width, device.height];
    const rmFiles = pages.map((pg, i) =>
      pg.strokes && pg.strokes.length
        ? buildRmPage(pg.strokes, {
            paperSize,
            authorUuid,
            layers: pg.layers || opts.layers,
          })
        : null
    );

    const pageIdx = (i) => {
      // fractional index strings: "ba", "bb", ... "bz", "ca", ...
      const a = "abcdefghijklmnopqrstuvwxyz";
      return a[1 + Math.floor(i / 26)] + a[i % 26];
    };

    const content = {
      cPages: {
        lastOpened: { timestamp: "1:1", value: pageUuids[0] },
        original: { timestamp: "0:0", value: -1 },
        pages: pageUuids.map((id, i) => {
          const entry = {
            id,
            idx: { timestamp: "1:2", value: pageIdx(i) },
            template: { timestamp: "1:2", value: "Blank" },
          };
          if (isPdf) entry.redir = { timestamp: "1:2", value: pages[i].pdfPage != null ? pages[i].pdfPage : i };
          return entry;
        }),
        uuids: [{ first: authorUuid, second: 1 }],
      },
      coverPageNumber: isPdf ? 0 : -1,
      customZoomCenterX: 0,
      customZoomCenterY: 936,
      customZoomOrientation: "portrait",
      customZoomPageHeight: 1872,
      customZoomPageWidth: 1404,
      customZoomScale: 1,
      documentMetadata: {},
      extraMetadata: {},
      fileType: isPdf ? "pdf" : "notebook",
      fontName: "",
      formatVersion: 2,
      lineHeight: -1,
      margins: 125,
      orientation: "portrait",
      pageCount: pages.length,
      pageTags: [],
      sizeInBytes: String(
        rmFiles.reduce((a, f) => a + (f ? f.length : 0), 0) + (isPdf ? opts.pdf.bytes.length : 0)
      ),
      tags: [],
      textAlignment: "justify",
      textScale: 1,
      zoomMode: "bestFit",
    };


    const metadata = {
      createdTime: nowMs,
      lastModified: nowMs,
      lastOpenedPage: 0,
      parent: "",
      pinned: false,
      type: "DocumentType",
      visibleName: opts.visibleName || "Sticker Sheet",
    };

    const entries = [
      { name: `${docUuid}.content`, data: utf8(JSON.stringify(content, null, 4)) },
      { name: `${docUuid}.metadata`, data: utf8(JSON.stringify(metadata, null, 4)) },
    ];
    if (isPdf) {
      entries.push({ name: `${docUuid}.pdf`, data: opts.pdf.bytes });
    } else {
      entries.push({ name: `${docUuid}.pagedata`, data: utf8(pages.map(() => "Blank").join("\n") + "\n") });
    }
    pageUuids.forEach((pu, i) => {
      if (rmFiles[i]) entries.push({ name: `${docUuid}/${pu}.rm`, data: rmFiles[i] });
    });

    return { bytes: buildZip(entries), docUuid, pageUuids };
  }

  return { buildRmPage, buildRmdoc, buildZip, uuid4, PEN, COLORS, DEVICES, crc32 };
});
