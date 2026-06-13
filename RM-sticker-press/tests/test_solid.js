const fs = require('fs'); const RMW = require('../src/rm_writer.js');
const src = fs.readFileSync('/tmp/script1.js','utf8');
function extract(name){const i=src.indexOf(`function ${name}(`);let j=src.indexOf('{',i),d=0;for(;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(!d)break;}}return src.slice(i,j+1);}
const PALETTE = RMW.COLORS; let state={device:'paperpro'}; const dev=()=>RMW.DEVICES[state.device];
const SOLID = eval('('+src.match(/const SOLID = (\{[^}]+\})/)[1]+')');
for (const f of ['simplifyDP','fillAngles','fillGapLocal','polygonHatch','tf','invTf','strokeColorIdx','fillColorIdx','deviceColorIdx','stickerStrokes']) eval(extract(f));
const pts=[];for(let i=0;i<=10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?42:100;pts.push({x:100+r*Math.cos(a),y:100+r*Math.sin(a)});}
const d0=dev();
const st={id:1,name:'s',src:null,srcOffset:{x:0,y:0},paths:[pts],pathColors:[7],w:200,h:200,cx:d0.width/2,cy:d0.height/2,scale:(d0.width*0.22)/200,rotation:0,tool:17,thickness:2,colMode:'auto',colorOverride:0,fillMode:'solid',hatchAngle:'45',hatchGap:8,fills:[],_fillsFresh:false};
st.fills = polygonHatch(st);
const strokes = stickerStrokes(st);
const fillStrokes = strokes.filter(s=>s.thicknessScale>7);
console.log('rows:', st.fills.length, 'fill strokes:', fillStrokes.length, 'outline strokes:', strokes.length-fillStrokes.length);
const samp = fillStrokes[Math.floor(fillStrokes.length/2)];
console.log('sample fill stroke: th=', samp.thicknessScale, 'pts=', samp.points.length, samp.points[0]);
if (Math.abs(samp.thicknessScale-7.07)>0.01) throw 'bad thickness';
if (samp.points[0].width!==18||samp.points[0].pressure!==255||samp.points[0].speed!==0) throw 'bad point params';
const {bytes}=RMW.buildRmdoc([{strokes}],{visibleName:'Solid Star',device:'paperpro'});
fs.writeFileSync('solid_star.rmdoc',Buffer.from(bytes));
console.log('solid_star.rmdoc', bytes.length, 'bytes');
