(() => {
 const body=document.body, catalog=document.querySelector('.sidebar');
 const toggle=document.getElementById('menusToggle');
 const resize=()=>requestAnimationFrame(()=>window.oksPortal?.map.invalidateSize({pan:false}));
 toggle.addEventListener('click',()=>{
  const hidden=body.classList.toggle('menus-collapsed');
  toggle.textContent=hidden?'Показать меню':'Свернуть все меню';
  toggle.setAttribute('aria-expanded',String(!hidden));resize();
 });
 document.getElementById('catalogToggle').addEventListener('click',function(){
  const hidden=catalog.classList.toggle('collapsed');
  this.setAttribute('aria-expanded',String(!hidden));
  this.textContent=hidden?'Каталог ▸':'Каталог и фильтры ▾';resize();
 });
 const card=document.getElementById('cardPanel'), button=document.getElementById('cardMinimize');
 button.addEventListener('click',()=>{
  const hidden=card.classList.toggle('minimized');
  button.textContent=hidden?'+':'−';button.setAttribute('aria-expanded',String(!hidden));
  button.setAttribute('aria-label',hidden?'Развернуть карточку':'Свернуть карточку');
 });
 new MutationObserver(()=>{
  if(!card.classList.contains('open') && card.classList.contains('minimized')){card.classList.remove('minimized');button.textContent='−';button.setAttribute('aria-expanded','true');button.setAttribute('aria-label','Свернуть карточку');}
 }).observe(card,{attributes:true,attributeFilter:['class']});
 const header=document.querySelector('.topbar');
 new ResizeObserver(()=>body.style.setProperty('--header-height',header.offsetHeight+'px')).observe(header);
})();
