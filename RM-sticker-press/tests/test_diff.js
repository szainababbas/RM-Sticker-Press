const RMW = require('../src/rm_writer.js');
const fs = require('fs');
const bytes = RMW.buildRmPage([
  { tool: 17, color: 0, thicknessScale: 2.0,
    points: [
      {x:0.0,y:0.0,speed:4,width:8,direction:0,pressure:200},
      {x:100.5,y:200.25,speed:4,width:8,direction:0,pressure:200},
    ] }
], { paperSize: [1620,2160], authorUuid: '495ba59f-c943-2b5c-b455-3682f6948906' });
fs.writeFileSync('candidate.rm', Buffer.from(bytes));
const ref = fs.readFileSync('reference.rm');
console.log('candidate', bytes.length, 'reference', ref.length);
if (Buffer.compare(Buffer.from(bytes), ref) === 0) console.log('BYTE-IDENTICAL ✔');
else {
  for (let i=0;i<Math.max(bytes.length, ref.length);i++) {
    if (bytes[i] !== ref[i]) { console.log('first diff at', i, bytes[i], ref[i]); break; }
  }
}
