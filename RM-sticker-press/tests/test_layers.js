const RMW = require('../src/rm_writer.js'); const fs = require('fs');
const mk = (y, layer) => ({ tool:17, color:0, thicknessScale:2, layer,
  points:[{x:-100,y,speed:4,width:8,direction:0,pressure:200},{x:100,y:y+50,speed:4,width:8,direction:0,pressure:200}]});
const {bytes} = RMW.buildRmdoc(
  [{strokes:[mk(100,0), mk(300,0), mk(500,1)]}],
  {visibleName:'Layer Test', device:'paperpro', layers:['Template','Writing']});
fs.writeFileSync('layer_test.rmdoc', Buffer.from(bytes));
console.log('layer_test.rmdoc', bytes.length);
