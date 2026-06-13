const RMW = require('../src/rm_writer.js'); const fs = require('fs');
const stroke = { tool:17, color:0, thicknessScale:2, points:[{x:-100,y:100,speed:4,width:8,direction:0,pressure:200},{x:100,y:300,speed:4,width:8,direction:0,pressure:200}] };
for (const d of Object.keys(RMW.DEVICES)) {
  const {bytes} = RMW.buildRmdoc([{strokes:[stroke]}], {visibleName:'t', device:d});
  fs.writeFileSync(`dev_${d}.rmdoc`, Buffer.from(bytes));
  console.log(d, RMW.DEVICES[d].width+'x'+RMW.DEVICES[d].height, bytes.length, 'bytes');
}
