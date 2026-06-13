const RMW = require('../src/rm_writer.js');
const fs = require('fs');
// stress: 2 pages, 300 strokes each, random colors/tools
function rnd(n){return Math.random()*n}
const mkPage = () => ({ strokes: Array.from({length:300}, (_,i) => ({
  tool: [15,16,17,21,23][i%5],
  color: RMW.COLORS[i % RMW.COLORS.length].id,
  thicknessScale: 1 + (i%5),
  points: Array.from({length: 40}, (_,j) => ({
    x: rnd(1600)-800, y: rnd(2100), speed:4, width: 8+(i%8), direction: j%256, pressure: 100+(j%150)
  }))
}))});
const {bytes, docUuid, pageUuids} = RMW.buildRmdoc([mkPage(), mkPage()], {visibleName:'Stress Test', device:'paperpro'});
fs.writeFileSync('stress.rmdoc', Buffer.from(bytes));
console.log('rmdoc bytes', bytes.length, 'doc', docUuid, 'pages', pageUuids.length);
