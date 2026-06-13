const RMW = require('../src/rm_writer.js'); const fs = require('fs');
const pdfBytes = new Uint8Array(fs.readFileSync('test2page.pdf'));

/* Calibration ink for PDF page 0 (letter 612x792, printed target (150,500)-(450,650) pdf-y-up).
   In "page width -> 1404" ink space (x centred, y from top), scale s = 1404/612 = 2.2941:
   target rect: x [150s-702, 450s-702] = [-357.9, 330.3], y [(792-650)s, (792-500)s] = [325.8, 669.9] */
const s = 1404/612;
function rect(x0,y0,x1,y1,color,inset) {
  const i = inset||0;
  const pts = [[x0+i,y0+i],[x1-i,y0+i],[x1-i,y1-i],[x0+i,y1-i],[x0+i,y0+i]]
    .map(([x,y]) => ({x, y, speed:4, width:8, direction:0, pressure:204}));
  return { tool:17, color, thicknessScale:2, points: pts };
}
// candidate B (our chosen mapping): single blue rect exactly on target
const B = [rect(150*s-702, (792-650)*s, 450*s-702, (792-500)*s, 6)];
// candidate A (1:1 pdf points): double red-ish rect (color 7) where target would be if 1:1
const A = [rect(150-306, 792-650, 450-306, 792-500, 7), rect(150-306, 792-650, 450-306, 792-500, 7, 6)];
// candidate C (width->1620): triple black rect
const c2 = 1620/612;
const C = [0,6,12].map(i => rect(150*c2-810, (792-650)*c2, 450*c2-810, (792-500)*c2, 0, i));

// page 2 (1620x2160): star at centre in width->1404 mapping (s2 = 1404/1620)
const s2 = 1404/1620;
const star = [];
{ const pts=[]; for(let i=0;i<=10;i++){const a=i*Math.PI/5-Math.PI/2, r=i%2?80:190;
    pts.push({x: (810+r*Math.cos(a))*s2-702, y:(1080+r*Math.sin(a))*s2, speed:4,width:8,direction:0,pressure:204});}
  star.push({tool:17,color:4,thicknessScale:2,points:pts}); }

const {bytes, docUuid} = RMW.buildRmdoc(
  [ {strokes:[...B, ...A, ...C], pdfPage:0},
    {strokes:star, pdfPage:1} ],
  { visibleName:'PDF Hybrid Calibration', device:'paperpro',
    layers:['Template','Writing'], pdf:{ bytes: pdfBytes } });
fs.writeFileSync('pdf_hybrid_calibration.rmdoc', Buffer.from(bytes));
console.log('pdf_hybrid_calibration.rmdoc', bytes.length, 'bytes, doc', docUuid);

// also: empty-page handling — pdf doc where page 1 has no ink
const r2 = RMW.buildRmdoc([{strokes:[], pdfPage:0},{strokes:star, pdfPage:1}],
  {visibleName:'x', device:'paperpro', pdf:{bytes:pdfBytes}});
fs.writeFileSync('pdf_empty_page.rmdoc', Buffer.from(r2.bytes));
console.log('pdf_empty_page.rmdoc OK');
