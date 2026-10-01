const fs = require('fs');
const RMW = require('../src/rm_writer.js');
const src = fs.readFileSync('/tmp/script1.js','utf8');

// extract named functions from the app source (brace matching)
function extract(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error('not found: '+name);
  let i = src.indexOf('{', idx), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(idx, j+1);
}

// stubs for app globals used by these functions
const PALETTE = RMW.COLORS;
let state = { device: 'paperpro' };
const dev = () => RMW.DEVICES[state.device];
const pageDims = () => dev(); // no PDF in these tests, so page dims are the device's

eval(extract('simplifyDP'));
eval(extract('splitSubpaths'));
eval(extract('fillAngles'));
eval(extract('fillGapLocal'));
const SOLID = eval('('+src.match(/const SOLID = (\{[^}]+\})/)[1]+')');
eval(extract('polygonHatch'));
eval(extract('tf'));
eval(extract('invTf'));
eval(extract('strokeColorIdx'));
eval(extract('deviceColorIdx'));
eval(extract('fillColorIdx'));
eval(extract('stickerStrokes'));

// --- test splitSubpaths ---
const subs = splitSubpaths('M10 10 L 20 10 c 5 5 10 5 10 0 Z m 5 -3 h10 v10 z M50,50 a5,5 0 1 0 10,0');
console.log('subpaths:', subs.length, JSON.stringify(subs));
if (subs.length !== 3) throw new Error('expected 3 subpaths');
if (!subs[1].startsWith('M 15 7')) throw new Error('relative m after Z mis-resolved: '+subs[1]);

// --- build a test star sticker like the app does ---
const pts = [];
for (let i = 0; i <= 10; i++) {
  const a = (i * Math.PI) / 5 - Math.PI / 2;
  const rad = i % 2 === 0 ? 100 : 42;
  pts.push({ x: 100 + rad * Math.cos(a), y: 100 + rad * Math.sin(a) });
}
const d0 = dev();
const st = {
  id: 1, name: 'Test star', src: null, srcOffset:{x:0,y:0},
  paths: [pts], pathColors: [6], w: 200, h: 200,
  cx: d0.width/2, cy: d0.height/2,
  scale: (d0.width*0.22)/200, rotation: 30,
  tool: 17, thickness: 2, colMode:'auto', colorOverride: 0,
  fillMode: 'both', hatchAngle: '45', hatchGap: 8, fills: [], _fillsFresh:false,
};
st.fills = polygonHatch(st);
console.log('hatch segments:', st.fills.length);
if (st.fills.length < 10) throw new Error('too few hatch segments');

// tf/invTf roundtrip
const p0 = {x: 12.3, y: 45.6};
const rt = invTf(st, tf(st, p0));
if (Math.hypot(rt.x-p0.x, rt.y-p0.y) > 1e-9) throw new Error('tf/invTf roundtrip failed');
console.log('tf/invTf roundtrip OK');

const strokes = stickerStrokes(st);
console.log('strokes:', strokes.length, 'points:', strokes.reduce((a,s)=>a+s.points.length,0));

// coordinate sanity: x in [-810,810], y in [0,2160]
for (const s of strokes) for (const p of s.points) {
  if (p.x < -810 || p.x > 810 || p.y < 0 || p.y > 2160) throw new Error('point out of page: '+JSON.stringify(p));
}
console.log('coordinates within Paper Pro page OK');

const {bytes} = RMW.buildRmdoc([{strokes}], {visibleName:'Star Test', device:'paperpro'});
fs.writeFileSync('star_test.rmdoc', Buffer.from(bytes));
console.log('star_test.rmdoc written:', bytes.length, 'bytes');
