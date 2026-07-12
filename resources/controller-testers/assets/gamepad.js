(function(){'use strict';
var gp=null,gpIdx=null,ctrlNameEl=null,statusEl=null;
var stickLeftContainer=null,stickRightContainer=null;
var stickLeftDot=null,stickRightDot=null;
var stickLeftCoords=null,stickRightCoords=null;
var axisBars=[],axisFillEls=[],axisLabels=[],axisValues=[],axisValueSpans=[];
var btnGrid=null,btnCells=[];
var touchpadEl=null,touchpadCountEl=null;
var vibrateContainer=null,vibeHeavy=null,vibeLight=null,vibeBurst=null,vibePulse=null;
var triggerContainer=null,triggerLfill=null,triggerRfill=null,triggerLabel=null;
var buttonCountEl=null;
var debug=[];

function log(){try{console.log.apply(console,arguments)}catch(e){}}
function dbg(m){try{debug.push(m)}catch(e){}}

function findElByText(root,text){
  if(!root)return null;
  var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false);
  var node;
  while(node=walker.nextNode()){
    if(node.textContent.trim()===text)return node.parentElement;
  }
  return null;
}

function findElContaining(root,text){
  if(!root)return null;
  var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false);
  var node;
  while(node=walker.nextNode()){
    if(node.textContent.indexOf(text)>=0)return node.parentElement;
  }
  return null;
}

function closest(el,sel){
  while(el){
    if(el.matches&&el.matches(sel))return el;
    el=el.parentElement;
  }
  return null;
}

function fmt(v){
  if(v===null||v===undefined)return'+0.00';
  return(v>=0?'+':'')+v.toFixed(2);
}

function init(){
  gp=null;gpIdx=null;
  ctrlNameEl=null;statusEl=null;
  stickLeftContainer=null;stickRightContainer=null;
  stickLeftDot=null;stickRightDot=null;
  stickLeftCoords=null;stickRightCoords=null;
  axisBars=[];axisFillEls=[];axisLabels=[];axisValues=[];axisValueSpans=[];
  btnGrid=null;btnCells=[];
  touchpadEl=null;touchpadCountEl=null;
  vibrateContainer=null;vibeHeavy=null;vibeLight=null;vibeBurst=null;vibePulse=null;
  triggerContainer=null;triggerLfill=null;triggerRfill=null;triggerLabel=null;
  buttonCountEl=null;
  debug=[];

  var body=document.body;
  if(!body){log('no body');return}

  // 1. Controller name: "Press any button to connect"
  ctrlNameEl=findElByText(body,'Press any button to connect');
  if(ctrlNameEl)dbg('ctrlNameEl found: '+ctrlNameEl.tagName+' .'+ctrlNameEl.className.slice(0,60));
  else{
    // Try by partial match
    var p=body.querySelector('[class*="group/name"] p');
    if(p){ctrlNameEl=p;dbg('ctrlNameEl via group/name')}
    else{
      var allP=body.querySelectorAll('p');
      for(var i=0;i<allP.length;i++){
        if(allP[i].textContent.trim()==='Press any button to connect'){
          ctrlNameEl=allP[i];dbg('ctrlNameEl via allP scan');break;
        }
      }
    }
  }
  if(!ctrlNameEl)dbg('WARN: ctrlNameEl NOT FOUND');

  // 2. "No Controller Detected" status
  statusEl=findElByText(body,'No Controller Detected');
  if(!statusEl){
    var els=body.querySelectorAll('[class*="text-["], div');
    for(var i=0;i<els.length;i++){
      if(els[i].textContent.trim()==='No Controller Detected'){
        statusEl=els[i];break;
      }
    }
  }
  if(statusEl)dbg('statusEl: '+statusEl.className.slice(0,40));

  // 3. Stick containers
  var stickSections=body.querySelectorAll('[class*="emerald"] [class*="rounded-full"]');
  stickSections=body.querySelectorAll('[class*="w-20"][class*="h-20"][class*="rounded-full"]');
  if(!stickSections||stickSections.length<2){
    stickSections=body.querySelectorAll('[class*="rounded-full"]');
    var stickCandidates=[];
    for(var i=0;i<stickSections.length;i++){
      var el=stickSections[i];
      if(el.offsetWidth>70&&el.offsetWidth<250&&el.offsetHeight>70&&el.offsetHeight<250){
        stickCandidates.push(el);
      }
    }
    log('stick candidates: '+stickCandidates.length);
    if(stickCandidates.length>=2){
      stickLeftContainer=stickCandidates[0];
      stickRightContainer=stickCandidates[1];
    }else if(stickCandidates.length===1){
      stickLeftContainer=stickCandidates[0];
    }
  }else{
    if(stickSections.length>=2){
      stickLeftContainer=stickSections[0];
      stickRightContainer=stickSections[1];
    }else if(stickSections.length===1){
      stickLeftContainer=stickSections[0];
    }
  }

  // 3b. Fallback: find stick text labels
  if(!stickLeftContainer){
    var leftLabel=findElByText(body,'Left Stick');
    if(leftLabel){
      var parent=leftLabel.parentElement;
      var cnt=0;
      while(parent&&cnt<10){
        var circles=parent.querySelectorAll('[class*="rounded-full"]');
        for(var i=0;i<circles.length;i++){
          if(circles[i].offsetWidth>60&&circles[i].offsetWidth<250){
            if(!stickLeftContainer)stickLeftContainer=circles[i];
            else if(!stickRightContainer&&circles[i]!==stickLeftContainer){
              stickRightContainer=circles[i];break;
            }
          }
        }
        parent=parent.parentElement;cnt++;
      }
    }
  }

  if(stickLeftContainer)dbg('stickL: '+stickLeftContainer.className.slice(0,40));
  if(stickRightContainer)dbg('stickR: '+stickRightContainer.className.slice(0,40));

  // Stick dots
  if(stickLeftContainer){
    stickLeftDot=stickLeftContainer.querySelector('[class*="bg-emerald"]');
    if(!stickLeftDot)stickLeftDot=stickLeftContainer.querySelector('[class*="bg-["]');
  }
  if(stickRightContainer){
    stickRightDot=stickRightContainer.querySelector('[class*="bg-emerald"]');
    if(!stickRightDot)stickRightDot=stickRightContainer.querySelector('[class*="bg-["]');
  }

  // Stick coords
  if(stickLeftContainer){
    var sc=stickLeftContainer.parentElement;
    if(sc)stickLeftCoords=sc.querySelector('[class*="tabular-nums"]');
  }
  if(stickRightContainer){
    var sc=stickRightContainer.parentElement;
    if(sc)stickRightCoords=sc.querySelector('[class*="tabular-nums"]');
  }

  // 4. Axis bars (Raw Data > Axes)
  var allRounded=body.querySelectorAll('[class*="rounded-full"]');
  for(var i=0;i<allRounded.length;i++){
    var el=allRounded[i];
    if(el.offsetHeight>4&&el.offsetHeight<30&&el.offsetWidth>15&&el.offsetWidth<500){
      var prev=el.previousElementSibling;
      if(prev&&prev.tagName==='SPAN'&&prev.textContent.trim().match(/^[0-9]+$/)){
        axisBars.push(el);
        axisLabels.push(prev);
        var valSpan=el.nextElementSibling;
        if(valSpan&&valSpan.tagName==='SPAN'){axisValues.push(valSpan)}
        else axisValues.push(null);
      }
    }
  }
  dbg('axisBars: '+axisBars.length);

  // 5. Button grid
  var candidateGrids=body.querySelectorAll('[class*="grid"]');
  for(var i=0;i<candidateGrids.length;i++){
    var g=candidateGrids[i];
    if(g.children.length>=10&&g.children.length<=30){
      var allDivs=true;
      var hasNum=false;
      for(var j=0;j<g.children.length;j++){
        var ch=g.children[j];
        if(ch.tagName!=='DIV'){allDivs=false;break}
        if(ch.textContent.trim().match(/^[0-9]+$/))hasNum=true;
      }
      if(allDivs&&hasNum){
        // Check if it's likely buttons (contains border-dashed)
        var hasDash=g.querySelector('[class*="border-dashed"]');
        if(hasDash||g.children.length>=14){
          if(!btnGrid||g.children.length>btnGrid.children.length){
            btnGrid=g;
          }
        }
      }
    }
  }
  if(btnGrid){
    var cells=[];
    for(var i=0;i<btnGrid.children.length;i++)cells.push(btnGrid.children[i]);
    btnCells=cells;
    dbg('btnGrid: '+cells.length+' cells');
  }else dbg('WARN: btnGrid NOT FOUND');

  // 6. Touchpad section
  var tpHeader=findElContaining(body,'Touchpad Test');
  if(!tpHeader)tpHeader=findElContaining(body,'touchpad');
  if(!tpHeader)tpHeader=findElByText(body,'Touchpad');
  if(tpHeader){
    var container=closest(tpHeader,'[class*="rounded-\\[2rem\\]"]')||closest(tpHeader,'[class*="rounded-["]')||tpHeader.parentElement;
    if(container){
      touchpadEl=container;
      touchpadCountEl=container.querySelector('[class*="tabular-nums"][class*="text-2xl"]')||container.querySelector('[class*="tabular-nums"]');
    }
  }
  dbg('touchpad: '+(touchpadEl?'found':'NOT FOUND'));

  // 7. Vibration section
  var vibeHeader=findElContaining(body,'Vibration Test');
  if(!vibeHeader)vibeHeader=findElContaining(body,'vibration');
  if(vibeHeader){
    var container=closest(vibeHeader,'[class*="rounded-\\[2rem\\]"]')||closest(vibeHeader,'[class*="rounded-["]')||vibeHeader.parentElement;
    if(container){
      vibrateContainer=container;
      var buttons=container.querySelectorAll('button');
      for(var i=0;i<buttons.length;i++){
        var txt=buttons[i].textContent.trim();
        if(txt==='HEAVY')vibeHeavy=buttons[i];
        else if(txt==='LIGHT')vibeLight=buttons[i];
        else if(txt==='BURST')vibeBurst=buttons[i];
        else if(txt==='PULSE')vibePulse=buttons[i];
      }
    }
  }
  dbg('vibration: '+(vibrateContainer?'found':'NOT FOUND'));

  // 7b. Trigger section
  var trigHeader=findElContaining(body,'Trigger Test');
  if(!trigHeader)trigHeader=findElContaining(body,'Trigger');
  if(trigHeader){
    var container=closest(trigHeader,'[class*="rounded-\\[2rem\\]"]')||closest(trigHeader,'[class*="rounded-["]')||trigHeader.parentElement;
    if(container){
      triggerContainer=container;
      var fills=container.querySelectorAll('[style*="width"]');
      if(fills.length>=2){
        triggerLfill=fills[0];
        triggerRfill=fills[1];
      }
      triggerLabel=container.querySelector('[class*="tabular-nums"]');
    }
  }
  dbg('triggers: '+(triggerContainer?'found':'NOT FOUND'));

  // 8. Total Press Count
  var tpc=findElByText(body,'Total Press Count');
  if(tpc){
    var parent=tpc.parentElement;
    if(parent)buttonCountEl=parent.querySelector('[class*="text-2xl"]')||parent.querySelector('[class*="tabular-nums"]');
  }

  log('init complete. sticks:',!!stickLeftContainer,!!stickRightContainer,'axes:',axisBars.length,'buttons:',btnCells.length,'touchpad:',!!touchpadEl,'vibe:',!!vibrateContainer);
}

function update(){
  try{var pads=navigator.getGamepads()}catch(e){return}
  var gamepad=null;
  if(pads){
    for(var i=0;i<pads.length;i++){
      if(pads[i]){gamepad=pads[i];break;}
    }
  }

  if(!gamepad){
    if(ctrlNameEl){ctrlNameEl.textContent='Press any button to connect';ctrlNameEl.style.color=''}
    if(statusEl){statusEl.textContent='No Controller Detected';statusEl.style.display=''}
    // Reset sticks
    if(stickLeftCoords)stickLeftCoords.textContent='+0.00, +0.00';
    if(stickRightCoords)stickRightCoords.textContent='+0.00, +0.00';
    if(stickLeftDot)stickLeftDot.style.transform='translate(0px, 0px)';
    if(stickRightDot)stickRightDot.style.transform='translate(0px, 0px)';
    // Reset axis bars
    for(var i=0;i<axisBars.length;i++){
      var fill=axisBars[i].querySelector('[style*="height"]');
      if(fill)fill.style.height='0%';
      if(axisValues[i])axisValues[i].textContent='+0.00';
    }
    // Reset buttons
    if(btnCells.length>0){
      for(var i=0;i<btnCells.length;i++){
        var cell=btnCells[i];
        if(cell){
          cell.className=cell.className.replace(/border-solid/g,'border-dashed');
          cell.style.backgroundColor='';
          cell.style.borderColor='';
        }
      }
    }
    if(buttonCountEl)buttonCountEl.textContent='0';
    if(touchpadCountEl)touchpadCountEl.textContent='0';
    if(triggerLfill)triggerLfill.style.width='0%';
    if(triggerRfill)triggerRfill.style.width='0%';
    if(triggerLabel)triggerLabel.textContent='0.00, 0.00';
    return;
  }

  // Controller connected
  if(ctrlNameEl){ctrlNameEl.textContent=gamepad.id;ctrlNameEl.style.color='rgb(16,185,129)'}
  if(statusEl){statusEl.textContent='';statusEl.style.display='none'}

  // Sticks (axes 0,1 = left; axes 2,3 = right)
  var lx=gamepad.axes[0]||0,ly=gamepad.axes[1]||0;
  var rx=gamepad.axes[2]||0,ry=gamepad.axes[3]||0;

  if(stickLeftCoords)stickLeftCoords.textContent=fmt(lx)+', '+fmt(ly);
  if(stickRightCoords)stickRightCoords.textContent=fmt(rx)+', '+fmt(ry);

  if(stickLeftDot)stickLeftDot.style.transform='translate('+(lx*50)+'px, '+(ly*50)+'px)';
  if(stickRightDot)stickRightDot.style.transform='translate('+(rx*50)+'px, '+(ry*50)+'px)';

  // Axis bars
  for(var i=0;i<axisBars.length&&i<gamepad.axes.length;i++){
    var val=gamepad.axes[i]||0;
    var fill=axisBars[i].querySelector('[style*="height"]');
    if(fill){
      var pct=Math.abs(val)*100;
      if(pct>100)pct=100;
      fill.style.height=pct+'%';
    }
    if(axisValues[i])axisValues[i].textContent=fmt(val);
  }

  // Buttons
  if(btnCells.length>0){
    for(var i=0;i<btnCells.length&&i<gamepad.buttons.length;i++){
      var cell=btnCells[i];
      var btn=gamepad.buttons[i];
      if(cell&&btn){
        if(btn.pressed){
          cell.className=cell.className.replace(/border-dashed/g,'border-solid');
          cell.style.backgroundColor='rgba(16,185,129,0.2)';
          cell.style.borderColor='rgb(16,185,129)';
        }else{
          cell.className=cell.className.replace(/border-solid/g,'border-dashed');
          cell.style.backgroundColor='';
          cell.style.borderColor='';
        }
      }
    }
  }

  // Triggers (buttons 6=L2, 7=R2 for most controllers)
  var l2val=gamepad.buttons[6]?gamepad.buttons[6].value:0;
  var r2val=gamepad.buttons[7]?gamepad.buttons[7].value:0;
  if(triggerLfill)triggerLfill.style.width=Math.round(l2val*100)+'%';
  if(triggerRfill)triggerRfill.style.width=Math.round(r2val*100)+'%';
  if(triggerLabel)triggerLabel.textContent=l2val.toFixed(2)+', '+r2val.toFixed(2);

  // Highlight trigger buttons in button grid
  if(btnCells[6]){
    btnCells[6].style.backgroundColor=l2val>0?'rgba(59,130,246,0.3)':'';
    btnCells[6].style.borderColor=l2val>0?'rgb(59,130,246)':'';
  }
  if(btnCells[7]){
    btnCells[7].style.backgroundColor=r2val>0?'rgba(59,130,246,0.3)':'';
    btnCells[7].style.borderColor=r2val>0?'rgb(59,130,246)':'';
  }

  // Button count
  if(buttonCountEl||touchpadCountEl){
    var pressed=0;
    for(var i=0;i<gamepad.buttons.length;i++){
      if(gamepad.buttons[i]&&gamepad.buttons[i].pressed)pressed++;
    }
    if(buttonCountEl)buttonCountEl.textContent=pressed;
    if(touchpadCountEl)touchpadCountEl.textContent=pressed;
  }
}

function vibe(mode){
  try{
    var pads=navigator.getGamepads();
    if(!pads||!pads[0])return;
    var act=pads[0].vibrationActuator;
    if(!act||!act.playEffect)return;
    var params={startDelay:0,duration:100,weakMagnitude:0.5,strongMagnitude:0.5};
    if(mode==='heavy'){params.duration=500;params.weakMagnitude=1;params.strongMagnitude=1}
    else if(mode==='light'){params.duration=200;params.weakMagnitude=0.3;params.strongMagnitude=0.3}
    else if(mode==='burst'){params.duration=100;params.weakMagnitude=1;params.strongMagnitude=0.3}
    act.playEffect('dual-rumble',params).catch(function(){});
    if(mode==='pulse'){
      var running=true;
      act.playEffect('dual-rumble',{startDelay:0,duration:100,weakMagnitude:1,strongMagnitude:0.5}).then(function fn(){
        if(running){
          act.playEffect('dual-rumble',{startDelay:0,duration:100,weakMagnitude:1,strongMagnitude:0.5}).then(function(){
            setTimeout(function(){act.playEffect('dual-rumble',{startDelay:0,duration:100,weakMagnitude:1,strongMagnitude:0.5}).then(fn).catch(function(){})},150)
          }).catch(function(){})
        }
      }).catch(function(){});
    }
  }catch(e){}
}

function stopVibe(){
  try{
    var pads=navigator.getGamepads();
    if(pads&&pads[0]&&pads[0].vibrationActuator&&pads[0].vibrationActuator.stop)
      pads[0].vibrationActuator.stop().catch(function(){});
  }catch(e){}
}

function loop(){
  update();
  requestAnimationFrame(loop);
}

// Kick off
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init();loop()});
else{init();loop()}

// Vibration button handlers (delegated)
document.addEventListener('click',function(e){
  var t=e.target;
  while(t&&t.tagName!=='BUTTON')t=t.parentElement;
  if(!t)return;
  var txt=t.textContent.trim();
  if(txt==='HEAVY'){stopVibe();vibe('heavy')}
  else if(txt==='LIGHT'){stopVibe();vibe('light')}
  else if(txt==='BURST'){stopVibe();vibe('burst')}
  else if(txt==='PULSE'){vibe('pulse')}
  else if(txt==='Reset'||txt===''){
    var svg=t.querySelector('svg');
    if(svg&&!svg.getAttribute('data-checked')){
      // reset stick
    }
  }
});

// Gamepad connect/disconnect events
window.addEventListener('gamepadconnected',function(e){
  gp=e.gamepad;gpIdx=gp.index;
  if(ctrlNameEl){ctrlNameEl.textContent=gp.id;ctrlNameEl.style.color='rgb(16,185,129)'}
  if(statusEl){statusEl.textContent='';statusEl.style.display='none'}
});
window.addEventListener('gamepaddisconnected',function(e){
  if(e.gamepad.index===gpIdx){gp=null;gpIdx=null}
});

log('gamepad.js loaded, debug:',debug.length,'entries');
})();
