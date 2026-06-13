const RMW = require('../src/rm_writer.js'); const fs = require('fs');
const pdfBytes = new Uint8Array(fs.readFileSync('test2page.pdf'));
function rect(x0,y0,x1,y1,color,inset){const i=inset||0;
  const pts=[[x0+i,y0+i],[x1-i,y0+i],[x1-i,y1-i],[x0+i,y1-i],[x0+i,y0+i]]
    .map(([x,y])=>({x,y,speed:4,width:8,direction:0,pressure:204}));
  return {tool:17,color,thicknessScale:2,points:pts};}
const DPI = 226/72; // 3.1389 — hypothesis: ink = pdf pts at 226 dpi, x centred, y from top
// PAGE 1 (612x792, printed target (150,500)-(450,650) pdf-y-up):
const w1=612,h1=792;
const p1 = [rect(150*DPI-(w1*DPI)/2,(h1-650)*DPI,450*DPI-(w1*DPI)/2,(h1-500)*DPI, 6)]; // single BLUE
// PAGE 2 (1620x2160, printed target (510,930)-(1110,1230) pdf-y-up):
const w2=1620,h2=2160;
const t2=(s)=>[510*s-(w2*s)/2,(h2-1230)*s,1110*s-(w2*s)/2,(h2-930)*s];
// candidate D: 226dpi rule — single GREEN rect
const [dx0,dy0,dx1,dy1]=t2(DPI);
// candidate E: "width -> 1920" rule — double MAGENTA rect
const sE=1920/w2; const [ex0,ey0,ex1,ey1]=t2(sE);
const p2=[rect(dx0,dy0,dx1,dy1,4), rect(ex0,ey0,ex1,ey1,12), rect(ex0,ey0,ex1,ey1,12,8)];
const {bytes}=RMW.buildRmdoc([{strokes:p1,pdfPage:0},{strokes:p2,pdfPage:1}],
  {visibleName:'PDF Calibration v2', device:'paperpro', pdf:{bytes:pdfBytes}});
fs.writeFileSync('pdf_calibration_v2.rmdoc', Buffer.from(bytes));
console.log('v2 written', bytes.length, 'bytes; page2 D rect:', [dx0,dy0,dx1,dy1].map(v=>Math.round(v)), 'E rect:', [ex0,ey0,ex1,ey1].map(v=>Math.round(v)));
