const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/client.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const mimeTypes = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
  res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'text/plain'});
  try { res.end(fs.readFileSync(filePath)); }
  catch(e) { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocket.Server({ server });

// === GAME LOGIC ===
const WEAPONS = {
  rifle: {name:'Rifle',damage:25,range:8,apCost:4,ammo:6,maxAmmo:6},
  shotgun: {name:'Shotgun',damage:40,range:4,apCost:5,ammo:4,maxAmmo:4},
  pistol: {name:'Pistola',damage:15,range:6,apCost:2,ammo:10,maxAmmo:10},
  sniper: {name:'Sniper',damage:60,range:12,apCost:6,ammo:3,maxAmmo:3},
};

const PERK_EFFECTS = {
  aim: u=>u.aimBonus=.15,
  speed: u=>u.moveCost=1,
  tank: u=>{u.maxHp+=25;u.hp+=25},
  fastReload: u=>u.reloadCost=1,
  grenadier: u=>u.grenadeBonus=10,
  regen: u=>u.regen=5,
};

function dist(a,b,c,d){return Math.abs(a-c)+Math.abs(b-d);}
function los(ax,ay,bx,by,obstacles){
  let x=ax,y=ay,dx=Math.abs(bx-ax),dy=Math.abs(by-ay),sx=ax<bx?1:-1,sy=ay<by?1:-1,err=dx-dy;
  while(true){if(x===bx&&y===by)return true;if(obstacles.some(o=>o.x===x&&o.y===y)&&!(x===ax&&y===ay))return false;let e2=2*err;if(e2>-dy){err-=dy;x+=sx}if(e2<dx){err+=dx;y+=sy}}
}
function inCover(x,y,obstacles){return [[0,-1],[0,1],[-1,0],[1,0]].some(([dx,dy])=>obstacles.some(o=>o.x===x+dx&&o.y===y+dy));}
function valid(x,y){return x>=0&&x<20&&y>=0&&y<15;}

function createUnit(id,x,y,team,wk){
  const w = WEAPONS[wk];
  return {id,x,y,team,hp:100,maxHp:100,ap:12,maxAp:12,weapon:{...w},moved:false,attacked:false,dead:false,overwatch:false,xp:0,level:1,perks:[],aimBonus:0,moveCost:2,reloadCost:2,grenadeBonus:0,regen:0};
}

function generateMap(){
  const obstacles=[];
  for(let i=0;i<22;i++){
    let ox=Math.floor(Math.random()*16)+2,oy=Math.floor(Math.random()*11)+2;
    if(!((ox<=4&&oy>=4&&oy<=10)||(ox>=15&&oy>=4&&oy<=10))) obstacles.push({x:ox,y:oy});
  }
  const crates=[];
  const types=['ammo','medkit','ap'];
  for(let i=0;i<5;i++){
    let cx=Math.floor(Math.random()*16)+2,cy=Math.floor(Math.random()*11)+2;
    if(!obstacles.some(o=>o.x===cx&&o.y===cy)) crates.push({x:cx,y:cy,type:types[Math.floor(Math.random()*3)],taken:false});
  }
  return {obstacles,crates};
}

function initGameState(){
  const {obstacles,crates} = generateMap();
  return {
    turn: 1,
    activeTeam: 0,
    units: [
      createUnit('u0',2,7,0,'rifle'), createUnit('u1',3,5,0,'shotgun'), createUnit('u2',3,9,0,'pistol'),
      createUnit('u3',17,7,1,'rifle'), createUnit('u4',16,5,1,'sniper'), createUnit('u5',16,9,1,'pistol'),
    ],
    obstacles, crates,
    winner: null,
  };
}

function resetAp(state){
  state.units.forEach(u=>{
    if(!u.dead){u.ap=u.maxAp;u.moved=false;u.attacked=false;u.overwatch=false;}
  });
}

function getUnit(state,id){return state.units.find(u=>u.id===id&&!u.dead);}
function getUnitAt(state,x,y){return state.units.find(u=>u.x===x&&u.y===y&&!u.dead);}

function checkWin(state){
  const ba=state.units.some(u=>u.team===0&&!u.dead);
  const ra=state.units.some(u=>u.team===1&&!u.dead);
  if(!ba) return 1;
  if(!ra) return 0;
  return null;
}

function doAttack(state,attackerId,targetId){
  const a = getUnit(state,attackerId);
  const t = getUnit(state,targetId);
  if(!a||!t||a.dead||t.dead||a.team===t.team) return {ok:false,msg:'Invalid target'};
  if(a.ap<a.weapon.apCost) return {ok:false,msg:'Not enough AP'};
  if(a.weapon.ammo<=0) return {ok:false,msg:'No ammo'};
  if(!los(a.x,a.y,t.x,t.y,state.obstacles)) return {ok:false,msg:'No LOS'};

  a.ap-=a.weapon.apCost; a.weapon.ammo--; a.attacked=true;
  const d=dist(a.x,a.y,t.x,t.y);
  let hc=.9-(d*.04)+a.aimBonus;
  if(inCover(t.x,t.y,state.obstacles)) hc-=.25;
  hc=Math.max(.05,Math.min(.98,hc));

  if(Math.random()<hc){
    let dmg=a.weapon.damage;
    if(inCover(t.x,t.y,state.obstacles)) dmg=Math.floor(dmg*.6);
    t.hp-=dmg;
    if(t.hp<=0){t.dead=true;t.hp=0;}
    return {ok:true,hit:true,damage:dmg,targetDead:t.dead,attacker:a.id,target:t.id};
  }
  return {ok:true,hit:false,attacker:a.id,target:t.id};
}

function doMove(state,unitId,tx,ty){
  const u=getUnit(state,unitId);
  if(!u) return {ok:false};
  const cost=dist(u.x,u.y,tx,ty)*u.moveCost;
  if(u.ap<cost) return {ok:false,msg:'Not enough AP'};
  if(!valid(tx,ty)) return {ok:false};
  if(getUnitAt(state,tx,ty)) return {ok:false};
  if(state.obstacles.some(o=>o.x===tx&&o.y===ty)) return {ok:false};
  u.ap-=cost; u.moved=true; u.x=tx; u.y=ty;

  // Loot
  const crate=state.crates.find(c=>c.x===tx&&c.y===ty&&!c.taken);
  if(crate){
    crate.taken=true;
    if(crate.type==='ammo') u.weapon.ammo=Math.min(u.weapon.maxAmmo+2,u.weapon.ammo+4);
    else if(crate.type==='medkit'){const h=Math.min(30,u.maxHp-u.hp);u.hp+=h;}
    else if(crate.type==='ap') u.ap=Math.min(u.maxAp+2,u.ap+4);
  }

  // Check overwatch
  for(const ow of state.units){
    if(ow.dead||ow.team===u.team||!ow.overwatch) continue;
    const d2=dist(ow.x,ow.y,u.x,u.y);
    if(d2<=ow.weapon.range&&los(ow.x,ow.y,u.x,u.y,state.obstacles)){
      ow.overwatch=false;
      let hc=.9-(d2*.04)+ow.aimBonus;
      if(inCover(u.x,u.y,state.obstacles)) hc-=.25;
      hc=Math.max(.05,Math.min(.98,hc));
      let dmg=0, hit=false, dead=false;
      if(Math.random()<hc){dmg=ow.weapon.damage;if(inCover(u.x,u.y,state.obstacles))dmg=Math.floor(dmg*.6);u.hp-=dmg;hit=true;if(u.hp<=0){u.dead=true;u.hp=0;dead=true;}}
      return {ok:true,overwatch:{attacker:ow.id,target:u.id,hit,damage:dmg,targetDead:dead},crate:crate?crate.type:null};
    }
  }
  return {ok:true,crate:crate?crate.type:null};
}

function doGrenade(state,unitId,tx,ty){
  const u=getUnit(state,unitId);
  if(!u||u.ap<4) return {ok:false};
  u.ap-=4; u.attacked=true;
  const hits=[];
  for(const target of state.units){
    if(target.dead) continue;
    const d=dist(tx,ty,target.x,target.y);
    if(d<=2){
      let dmg=35+u.grenadeBonus;
      if(d===2) dmg=20+u.grenadeBonus;
      if(inCover(target.x,target.y,state.obstacles)) dmg=Math.floor(dmg*.7);
      target.hp-=dmg;
      const dead=target.hp<=0;
      if(dead){target.dead=true;target.hp=0;}
      hits.push({target:target.id,damage:dmg,dead});
    }
  }
  return {ok:true,hits,center:{x:tx,y:ty}};
}

function doReload(state,unitId){
  const u=getUnit(state,unitId);
  if(!u||u.ap<u.reloadCost||u.weapon.ammo>=u.weapon.maxAmmo) return {ok:false};
  u.ap-=u.reloadCost; u.weapon.ammo=u.weapon.maxAmmo;
  return {ok:true};
}

function doOverwatch(state,unitId){
  const u=getUnit(state,unitId);
  if(!u||u.ap<3||u.overwatch) return {ok:false};
  u.ap-=3; u.overwatch=true;
  return {ok:true};
}

function doBuyPerk(state,unitId,perkId){
  const u=getUnit(state,unitId);
  if(!u||u.dead) return {ok:false};
  const costs={aim:30,speed:25,tank:35,fastReload:20,grenadier:30,regen:40};
  const cost=costs[perkId];
  if(!cost||u.perks.includes(perkId)||u.xp<cost) return {ok:false};
  u.xp-=cost;
  if(PERK_EFFECTS[perkId]) PERK_EFFECTS[perkId](u);
  u.perks.push(perkId);
  return {ok:true,perkId};
}

function endTurn(state){
  state.activeTeam = 1-state.activeTeam;
  if(state.activeTeam===0) state.turn++;
  resetAp(state);
  return {ok:true};
}

// === ROOMS ===
const rooms = new Map();

function genCode(){return Math.floor(1000+Math.random()*9000).toString();}

function broadcast(room,msg){
  room.players.forEach(p=>{if(p.ws.readyState===1)p.ws.send(JSON.stringify(msg));});
}

function sendState(room){
  broadcast(room,{type:'state',state:{
    turn:room.state.turn,
    activeTeam:room.state.activeTeam,
    units:room.state.units,
    obstacles:room.state.obstacles,
    crates:room.state.crates,
    winner:room.state.winner,
  }});
}

wss.on('connection',(ws)=>{
  let playerRoom = null;
  let playerTeam = null;

  ws.on('message',(data)=>{
    let msg;
    try{msg=JSON.parse(data);}catch(e){return;}

    if(msg.type==='create'){
      const code = genCode();
      const room = {
        code, players:[{ws,team:0}], state:initGameState(), started:false, full:false
      };
      rooms.set(code,room);
      playerRoom=room; playerTeam=0;
      ws.send(JSON.stringify({type:'created',code}));
      ws.send(JSON.stringify({type:'assigned',team:0}));
      sendState(room);
    }

    else if(msg.type==='join'){
      const room = rooms.get(msg.code);
      if(!room){ws.send(JSON.stringify({type:'error',msg:'Sala não encontrada'}));return;}
      if(room.players.length>=2){ws.send(JSON.stringify({type:'error',msg:'Sala cheia'}));return;}
      room.players.push({ws,team:1});
      playerRoom=room; playerTeam=1;
      room.started=true; room.full=true;
      ws.send(JSON.stringify({type:'joined',code:msg.code}));
      ws.send(JSON.stringify({type:'assigned',team:1}));
      broadcast(room,{type:'start'});
      sendState(room);
    }

    else if(msg.type==='action' && playerRoom && playerRoom.started){
      const state = playerRoom.state;
      if(state.winner!==null) return;
      if(state.activeTeam!==playerTeam) return;

      let result = {ok:false};
      let actionType = msg.action;

      if(actionType==='move'){
        result = doMove(state,msg.unitId,msg.x,msg.y);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'move',unit:msg.unitId,x:msg.x,y:msg.y,overwatch:result.overwatch||null,crate:result.crate||null});
        }
      }
      else if(actionType==='attack'){
        result = doAttack(state,msg.unitId,msg.targetId);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'attack',...result});
        }
      }
      else if(actionType==='grenade'){
        result = doGrenade(state,msg.unitId,msg.x,msg.y);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'grenade',...result});
        }
      }
      else if(actionType==='reload'){
        result = doReload(state,msg.unitId);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'reload',unit:msg.unitId});
        }
      }
      else if(actionType==='overwatch'){
        result = doOverwatch(state,msg.unitId);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'overwatch',unit:msg.unitId});
        }
      }
      else if(actionType==='buyPerk'){
        result = doBuyPerk(state,msg.unitId,msg.perkId);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'buyPerk',unit:msg.unitId,perkId:msg.perkId});
        }
      }
      else if(actionType==='endTurn'){
        result = endTurn(state);
        if(result.ok){
          broadcast(playerRoom,{type:'event',event:'endTurn',turn:state.turn,activeTeam:state.activeTeam});
        }
      }

      if(result.ok){
        const winner = checkWin(state);
        if(winner!==null){state.winner=winner; broadcast(playerRoom,{type:'winner',winner});}
        sendState(playerRoom);
      }
    }
  });

  ws.on('close',()=>{
    if(playerRoom){
      playerRoom.players = playerRoom.players.filter(p=>p.ws!==ws);
      if(playerRoom.players.length===0) rooms.delete(playerRoom.code);
      else broadcast(playerRoom,{type:'disconnected',msg:'Oponente desconectou'});
    }
  });
});

server.listen(PORT,()=>{console.log(`Servidor rodando na porta ${PORT}`);});
