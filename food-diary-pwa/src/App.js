import { useState, useEffect, useCallback, useRef } from 'react';
import { getDayData, saveDayData, getAllData } from './supabase';

const NORMS = { cal: 2000, prot: 130, fat: 65, carb: 220, fiber: 30, sfat: 20 };
const MOODS = ['😄','😊','😐','😔','😴','💪','🤒'];
const WATER_GOAL = 8;
function todayStr() { return new Date().toISOString().split('T')[0]; }
function addDays(s, d) { const dt = new Date(s + 'T12:00:00'); dt.setDate(dt.getDate() + d); return dt.toISOString().split('T')[0]; }
function formatDateRu(s) { return new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }

const LC = {
  light: {
    bg:'#f5f0e8', bg2:'#ffffff', bg3:'#faf7f2', border:'#e8dcc8', border2:'#d8c8a8',
    text:'#2a1f14', text2:'#9a8060', text3:'#c0a880', accent:'#c17f3e', green:'#5a8a4a',
    red:'#b04040', blue:'#3a6a9a', header:'#2a1f14', headerTxt:'#e8d5a0', shadow:'0 2px 16px rgba(42,31,20,0.1)',
    cal:'#c17f3e', prot:'#5a8a4a', fat:'#a04060', carb:'#3a6a9a', fiber:'#4a7a3a', sfat:'#b04040',
  },
  dark: {
    bg:'#111418', bg2:'#1a1f26', bg3:'#222830', border:'#2a3040', border2:'#333d50',
    text:'#e8dfc8', text2:'#8a9080', text3:'#5a6058', accent:'#e0a060', green:'#7ab86a',
    red:'#d06060', blue:'#6a9aca', header:'#0d1117', headerTxt:'#c8b888', shadow:'0 2px 16px rgba(0,0,0,0.4)',
    cal:'#e0a060', prot:'#7ab86a', fat:'#c06080', carb:'#6a9aca', fiber:'#6ab85a', sfat:'#d06060',
  }
};

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('diary_dark') === '1');
  const [tab, setTab] = useState('diary');
  const [date, setDate] = useState(todayStr());
  const [dayData, setDayData] = useState({ meals: [], water: 0, mood: null, mood_note: '', ai_rec: null });
  const [allData, setAllData] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const fileRef = useRef();
  const T = dark ? LC.dark : LC.light;

  const loadDay = useCallback(async (d) => {
    setSyncing(true);
    const data = await getDayData(d);
    setDayData({ meals: data.meals || [], water: data.water || 0, mood: data.mood || null, mood_note: data.mood_note || '', ai_rec: data.ai_rec || null });
    setSyncing(false);
  }, []);

  const loadAll = useCallback(async () => {
    const rows = await getAllData(); setAllData(rows);
  }, []);

  useEffect(() => { loadDay(date); }, [date, loadDay]);
  useEffect(() => { if (tab === 'charts') loadAll(); }, [tab, loadAll]);

  async function updateDay(fields) {
    const updated = { ...dayData, ...fields };
    setDayData(updated);
    await saveDayData(date, { meals: updated.meals, water: updated.water, mood: updated.mood, mood_note: updated.mood_note, ai_rec: updated.ai_rec });
  }

  const totals = (dayData.meals || []).reduce((a, m) => { for (const k in a) a[k] += parseFloat(m[k]) || 0; return a; }, { cal:0, prot:0, fat:0, carb:0, fiber:0, sfat:0 });

  function setStatusMsg(text, err = false, dur = 4000) {
    setStatus({ text, err }); setTimeout(() => setStatus(null), dur);
  }

  async function handlePhoto(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPhoto({ base64: ev.target.result.split(',')[1], preview: ev.target.result, type: file.type || 'image/jpeg' }); };
    reader.readAsDataURL(file);
  }

  async function callClaude(messages, maxTokens = 2000) {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`API ${res.status}: ${e.error?.message || res.statusText}`); }
    const data = await res.json();
    return data.content.map(c => c.text || '').join('').trim();
  }

  async function analyze() {
    if ((!input.trim() && !photo) || loading) return;
    setLoading(true); setStatus({ text: photo ? 'Распознаю блюда на фото...' : 'Анализирую состав...', err: false });
    try {
      const contentArr = photo
        ? [{ type:'image', source:{ type:'base64', media_type:photo.type, data:photo.base64 } },
           { type:'text', text:`Определи все блюда на фото и рассчитай КБЖУ.${input.trim() ? ' Уточнение: ' + input.trim() : ''}\nВерни ТОЛЬКО JSON-массив без markdown:\n[{"name":"название","cal":число,"prot":число,"fat":число,"carb":число,"fiber":число,"sfat":число}]\nЧисла целые. sfat=насыщенные жиры г. name на русском до 50 символов.` }]
        : [{ type:'text', text:`Проанализируй питание. Если несколько приёмов — раздели на записи.\nВерни ТОЛЬКО JSON-массив без markdown:\n[{"name":"название","cal":число,"prot":число,"fat":число,"carb":число,"fiber":число,"sfat":число}]\nЧисла целые. sfat=насыщенные жиры г. name на русском до 50 символов.\nЕда: ${input.trim()}` }];

      let text = await callClaude([{ role:'user', content: contentArr }]);
      text = text.replace(/```json|```/g,'').trim();
      const match = text.match(/\[[\s\S]*\]/); if (match) text = match[0];
      const newMeals = JSON.parse(text);
      if (!Array.isArray(newMeals)) throw new Error('Неверный формат');

      const now = new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
      const withMeta = newMeals.map(m => ({ ...m, time: now, hasPhoto: !!photo }));
      const updatedMeals = [...(dayData.meals || []), ...withMeta];
      await updateDay({ meals: updatedMeals });

      setInput(''); setPhoto(null); if (fileRef.current) fileRef.current.value = '';
      const tc = withMeta.reduce((s,m) => s + (m.cal||0), 0);
      setStatusMsg(withMeta.length > 1 ? `Добавлено ${withMeta.length} приёма — ${tc} ккал` : `✓ ${withMeta[0].name} — ${withMeta[0].cal} ккал`);

      // AI recommendation
      getAiRec(updatedMeals);
    } catch(e) { setStatusMsg(`Ошибка: ${e.message}`, true, 7000); }
    setLoading(false);
  }

  async function getAiRec(meals) {
    setAiLoading(true);
    try {
      const t = meals.reduce((a,m)=>{for(const k in a)a[k]+=parseFloat(m[k])||0;return a;},{cal:0,prot:0,fat:0,carb:0,fiber:0,sfat:0});
      let text = await callClaude([{ role:'user', content:`Пользователь ведёт дневник питания. Цели: снизить холестерин, похудеть. Нормы: калории 2000, белки 130г, жиры 65г, углеводы 220г, клетчатка 30г, насыщенные жиры макс 20г.\n\nСъедено: ${meals.map(m=>m.name).join(', ')}\nИтого: ккал ${Math.round(t.cal)}, белки ${Math.round(t.prot)}г, жиры ${Math.round(t.fat)}г, углеводы ${Math.round(t.carb)}г, клетчатка ${Math.round(t.fiber)}г, нас.жиры ${Math.round(t.sfat)}г.\n\nКороткие рекомендации на остаток дня. ТОЛЬКО JSON без markdown:\n{"avoid":["макс 3 пункта"],"add":["макс 3 пункта"],"tip":"одна мысль до 80 символов"}` }], 600);
      text = text.replace(/```json|```/g,'').trim();
      const match = text.match(/\{[\s\S]*\}/); if (match) text = match[0];
      const rec = JSON.parse(text);
      // Сохраняем только ai_rec, не трогая остальные поля
      const current = await getDayData(date);
      await saveDayData(date, {
        meals: current.meals || meals,
        water: current.water || 0,
        mood: current.mood || null,
        mood_note: current.mood_note || '',
        ai_rec: rec
      });
      setDayData(prev => ({ ...prev, ai_rec: rec }));
    } catch(e) { console.error(e); }
    setAiLoading(false);
  }

  async function deleteMeal(i) {
    const meals = [...(dayData.meals||[])]; meals.splice(i,1);
    await updateDay({ meals });
  }

  // Charts data
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));return d.toISOString().split('T')[0];});
  const shortLabels = last7.map(d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'numeric'}));
  function getDayTotals(dateStr) {
    const row = allData.find(r => r.date === dateStr);
    const ms = row?.meals || [];
    return ms.reduce((a,m)=>{for(const k in a)a[k]+=parseFloat(m[k])||0;return a;},{cal:0,prot:0,fat:0,carb:0,fiber:0,sfat:0});
  }
  const dayTotals = last7.map(getDayTotals);

  const tips_good=['Овсянка, ячмень — бета-глюкан снижает ЛПНП','Жирная рыба (скумбрия, лосось) — омега-3','Грецкие орехи, миндаль — 30г в день','Оливковое масло первого отжима','Авокадо — мононенасыщенные жиры','Бобовые (чечевица, нут) — клетчатка + белок','Чеснок — снижает холестерин','Яблоки, груши, цитрусовые — пектин','Зелёный чай — полифенолы EGCG'];
  const tips_bad=['Красное мясо — не более 2 раз в нед.','Колбасы, сосиски, полуфабрикаты','Сливочное масло, сало','Жирные сливки, сметана, майонез','Трансжиры: маргарин, выпечка, фастфуд','Кокосовое и пальмовое масло','Белый хлеб, сахар, сладкое','Алкоголь — повышает триглицериды'];

  function BarChart({values,norm,color,warnOver,labels}) {
    const max=Math.max(norm*1.3,...values,1);
    return(
      <div style={{display:'flex',alignItems:'flex-end',gap:4,height:90,position:'relative',paddingBottom:18}}>
        <div style={{position:'absolute',bottom:18+(norm/max)*72,left:0,right:0,borderTop:`1px dashed ${T.border2}`,zIndex:1}}/>
        {values.map((v,i)=>{
          const h=Math.max(2,(v/max)*72);const over=warnOver&&v>norm;
          return(<div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
            <div style={{position:'absolute',bottom:18,width:'80%',height:h,background:over?T.red:color,borderRadius:'3px 3px 0 0',opacity:v>0?0.85:0.15,transition:'height 0.4s'}}/>
            <div style={{position:'absolute',bottom:0,fontFamily:'sans-serif',fontSize:8,color:T.text3,whiteSpace:'nowrap'}}>{labels[i]}</div>
          </div>);
        })}
      </div>
    );
  }

  const card = {background:T.bg2,borderRadius:16,padding:'18px 16px',boxShadow:T.shadow,marginBottom:14};
  const secTitle = {fontFamily:'sans-serif',fontSize:11,letterSpacing:'0.12em',textTransform:'uppercase',color:T.text2,marginBottom:12,display:'flex',alignItems:'center',gap:8};

  return (
    <div style={{background:T.bg,minHeight:'100vh',fontFamily:'Georgia,serif',color:T.text,transition:'background 0.3s',paddingBottom:80}}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        textarea:focus{border-color:${T.accent}!important;outline:none}
        input:focus{outline:none}
        button{cursor:pointer}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${T.border2};border-radius:2px}
      `}</style>

      {/* Header */}
      <div style={{background:T.header,padding:'env(safe-area-inset-top, 12px) 20px 12px',position:'sticky',top:0,zIndex:100,boxShadow:'0 2px 20px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:18,color:T.headerTxt,fontStyle:'italic'}}>Дневник питания</div>
            {syncing&&<div style={{fontFamily:'sans-serif',fontSize:9,color:'#7a6a50',letterSpacing:'0.1em'}}>синхронизация...</div>}
          </div>
          <button onClick={()=>{const nd=!dark;setDark(nd);localStorage.setItem('diary_dark',nd?'1':'0');}} style={{background:'none',border:`1px solid ${T.border2}`,color:T.text2,width:34,height:34,borderRadius:10,fontSize:16}}>
            {dark?'☀️':'🌙'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:'16px 16px 0',maxWidth:600,margin:'0 auto'}}>

        {/* DIARY */}
        {tab==='diary'&&<>
          {/* Date nav */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
            <button onClick={()=>setDate(d=>addDays(d,-1))} style={{background:T.bg2,border:`1px solid ${T.border2}`,color:T.text2,width:36,height:36,borderRadius:10,fontSize:18,boxShadow:T.shadow}}>‹</button>
            <div style={{flex:1,textAlign:'center',fontFamily:'sans-serif',fontSize:14,color:T.text,fontWeight:500}}>{formatDateRu(date)}</div>
            <button onClick={()=>setDate(d=>addDays(d,1))} style={{background:T.bg2,border:`1px solid ${T.border2}`,color:T.text2,width:36,height:36,borderRadius:10,fontSize:18,boxShadow:T.shadow}}>›</button>
          </div>
          {date!==todayStr()&&<div style={{textAlign:'center',marginBottom:12}}>
            <button onClick={()=>setDate(todayStr())} style={{background:'none',border:`1px solid ${T.border2}`,color:T.text2,padding:'4px 14px',fontFamily:'sans-serif',fontSize:11,borderRadius:20,letterSpacing:'0.06em'}}>← Сегодня</button>
          </div>}

          {/* Metrics grid */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
            {[['cal','Калории','ккал',false],['prot','Белки','г',false],['fat','Жиры','г',false],['carb','Углев.','г',false],['fiber','Клетч.','г',false],['sfat','Нас.жиры','г',true]].map(([k,label,unit,warn])=>{
              const val=totals[k],norm=NORMS[k],pct=(val/norm)*100,over=warn&&val>norm,color=T[k];
              return(
                <div key={k} style={{background:T.bg2,borderRadius:14,padding:'12px 10px',textAlign:'center',boxShadow:T.shadow,borderTop:`3px solid ${over?T.red:color}`}}>
                  <div style={{fontFamily:'sans-serif',fontSize:9,letterSpacing:'0.1em',textTransform:'uppercase',color:T.text2,marginBottom:6}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:700,color:over?T.red:color,lineHeight:1,fontFamily:'sans-serif'}}>{Math.round(val)}</div>
                  <div style={{fontFamily:'sans-serif',fontSize:9,color:T.text3,margin:'4px 0'}}>{warn?`макс ${norm}`:`из ${norm}`} {unit}</div>
                  <div style={{height:3,background:T.border,borderRadius:2}}><div style={{height:'100%',width:Math.min(100,pct)+'%',background:over?T.red:color,borderRadius:2,transition:'width 0.5s'}}/></div>
                </div>
              );
            })}
          </div>

          {/* Water + Mood */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
            <div style={card}>
              <div style={secTitle}><span>💧</span>Вода</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}}>
                {Array.from({length:WATER_GOAL}).map((_,i)=>(
                  <button key={i} onClick={()=>updateDay({water:i<dayData.water?i:i+1})} style={{background:'none',border:'none',fontSize:18,opacity:i<dayData.water?1:0.2,padding:'2px',transition:'opacity 0.15s'}}>🥤</button>
                ))}
              </div>
              <div style={{height:4,background:T.border,borderRadius:2,marginBottom:6}}>
                <div style={{height:'100%',width:Math.min(100,(dayData.water/WATER_GOAL)*100)+'%',background:T.blue,borderRadius:2,transition:'width 0.4s'}}/>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>updateDay({water:Math.max(0,dayData.water-1)})} style={{flex:1,background:T.bg3,border:`1px solid ${T.border}`,color:T.text2,padding:'6px',fontFamily:'sans-serif',fontSize:13,borderRadius:8}}>−</button>
                <button onClick={()=>updateDay({water:Math.min(12,dayData.water+1)})} style={{flex:2,background:T.blue+'22',border:`1px solid ${T.blue}`,color:T.blue,padding:'6px',fontFamily:'sans-serif',fontSize:12,borderRadius:8,fontWeight:600}}>+ стакан</button>
              </div>
            </div>

            <div style={card}>
              <div style={secTitle}><span>📓</span>Заметки</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:8}}>
                {MOODS.map(m=>(
                  <button key={m} onClick={()=>updateDay({mood:m})} style={{background:dayData.mood===m?T.accent+'22':'none',border:`1px solid ${dayData.mood===m?T.accent:T.border}`,borderRadius:8,padding:'3px 6px',fontSize:18,transition:'all 0.15s'}}>{m}</button>
                ))}
              </div>
              <textarea value={dayData.mood_note} onChange={e=>updateDay({mood_note:e.target.value})}
                placeholder="Самочувствие, энергия..."
                rows={2} style={{background:T.bg3,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px',fontFamily:'Georgia,serif',fontSize:12,color:T.text,resize:'none',width:'100%',lineHeight:1.5,boxSizing:'border-box'}}/>
            </div>
          </div>

          {/* AI Rec */}
          {(dayData.ai_rec||aiLoading)&&(
            <div style={{...card,borderLeft:`4px solid ${T.accent}`,animation:'fadeIn 0.4s ease'}}>
              <div style={secTitle}><span>🤖</span>Рекомендация ИИ</div>
              {aiLoading?(
                <div style={{display:'flex',alignItems:'center',gap:8,color:T.text2,fontFamily:'sans-serif',fontSize:13}}>
                  <div style={{width:7,height:7,borderRadius:'50%',background:T.accent,animation:'pulse 1.2s infinite'}}/>
                  Анализирую рацион...
                </div>
              ):(
                <>
                  {dayData.ai_rec?.tip&&<div style={{fontFamily:'sans-serif',fontSize:12,color:T.accent,fontWeight:600,marginBottom:12,padding:'8px 12px',background:T.accent+'15',borderRadius:8}}>💡 {dayData.ai_rec.tip}</div>}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div>
                      <div style={{fontFamily:'sans-serif',fontSize:10,color:T.green,fontWeight:600,letterSpacing:'0.08em',marginBottom:6}}>✓ ДОБАВИТЬ</div>
                      {(dayData.ai_rec?.add||[]).map((t,i)=><div key={i} style={{fontSize:12,color:T.text,padding:'4px 0',borderBottom:`1px solid ${T.border}`,lineHeight:1.4,fontFamily:'sans-serif'}}><span style={{color:T.green}}>→ </span>{t}</div>)}
                    </div>
                    <div>
                      <div style={{fontFamily:'sans-serif',fontSize:10,color:T.red,fontWeight:600,letterSpacing:'0.08em',marginBottom:6}}>✗ ИЗБЕГАТЬ</div>
                      {(dayData.ai_rec?.avoid||[]).map((t,i)=><div key={i} style={{fontSize:12,color:T.text,padding:'4px 0',borderBottom:`1px solid ${T.border}`,lineHeight:1.4,fontFamily:'sans-serif'}}><span style={{color:T.red}}>→ </span>{t}</div>)}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Input */}
          <div style={card}>
            <div style={secTitle}><span style={{width:6,height:6,background:T.accent,borderRadius:'50%',display:'inline-block'}}/>Добавить приём</div>
            {photo&&(
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,padding:'8px 10px',background:T.bg3,borderRadius:10}}>
                <img src={photo.preview} style={{width:60,height:60,objectFit:'cover',borderRadius:8,border:`2px solid ${T.border}`}} alt="food"/>
                <div style={{flex:1}}>
                  <div style={{fontFamily:'sans-serif',fontSize:11,color:T.green,fontWeight:600}}>✓ Фото загружено</div>
                  <div style={{fontFamily:'sans-serif',fontSize:10,color:T.text2,marginTop:2}}>ИИ определит блюда автоматически</div>
                </div>
                <button onClick={()=>{setPhoto(null);if(fileRef.current)fileRef.current.value='';}} style={{background:'none',border:'none',color:T.text3,fontSize:20,lineHeight:1,padding:4}}>×</button>
              </div>
            )}
            <textarea value={input} onChange={e=>setInput(e.target.value)}
              placeholder={photo?'Уточнение (необязательно)...':'Что ты ел? Например: гречка 150г с курицей, огурец...'}
              rows={3} style={{background:T.bg3,border:`2px solid ${T.border}`,borderRadius:10,padding:'10px 12px',fontFamily:'Georgia,serif',fontSize:14,color:T.text,resize:'none',width:'100%',lineHeight:1.6,boxSizing:'border-box',transition:'border-color 0.2s'}}/>
            <div style={{display:'flex',gap:8,marginTop:10}}>
              <button onClick={()=>fileRef.current?.click()} style={{background:T.bg3,border:`1px solid ${T.border2}`,color:T.text2,padding:'10px 14px',fontFamily:'sans-serif',fontSize:12,borderRadius:10,display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:16}}>📷</span>{photo?'Сменить':'Фото'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{display:'none'}}/>
              <button onClick={analyze} disabled={loading||(!input.trim()&&!photo)} style={{flex:1,background:loading||(!input.trim()&&!photo)?T.text3:T.accent,border:'none',color:'#fff',padding:'10px',fontFamily:'sans-serif',fontSize:13,letterSpacing:'0.08em',textTransform:'uppercase',borderRadius:10,fontWeight:600,transition:'background 0.2s'}}>
                {loading?'Анализирую...':'Анализ →'}
              </button>
            </div>
          </div>

          {status&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',background:status.err?T.red+'15':T.green+'15',borderRadius:10,border:`1px solid ${status.err?T.red:T.green}`,marginBottom:12,animation:'fadeIn 0.3s'}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:status.err?T.red:T.green,animation:status.err?'none':'pulse 1.2s infinite',flexShrink:0}}/>
              <span style={{fontFamily:'sans-serif',fontSize:12,color:status.err?T.red:T.green}}>{status.text}</span>
            </div>
          )}

          {/* Meals */}
          <div style={card}>
            <div style={secTitle}><span style={{width:6,height:6,background:T.green,borderRadius:'50%',display:'inline-block'}}/>Приёмы пищи</div>
            {(!dayData.meals||dayData.meals.length===0)?(
              <div style={{textAlign:'center',padding:'32px 16px',color:T.text3}}>
                <div style={{fontSize:36,marginBottom:8}}>🥗</div>
                <div style={{fontFamily:'sans-serif',fontSize:12,lineHeight:2}}>Записей пока нет<br/><span>Опиши еду или загрузи фото</span></div>
              </div>
            ):(
              <div>
                {(dayData.meals||[]).map((m,i)=>(
                  <div key={i} style={{padding:'10px 0',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        {m.hasPhoto&&<span style={{fontSize:12}}>📷</span>}
                        <div style={{fontFamily:'Georgia,serif',fontSize:14,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</div>
                      </div>
                      {m.time&&<div style={{fontFamily:'sans-serif',fontSize:10,color:T.text3,marginTop:2}}>{m.time}</div>}
                      <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                        {[['cal',T.cal],['prot',T.prot],['fat',T.fat],['carb',T.carb],['fiber',T.fiber],['sfat',T.sfat]].map(([k,c])=>(
                          <span key={k} style={{fontFamily:'sans-serif',fontSize:10,color:c,fontWeight:600,background:c+'15',padding:'1px 6px',borderRadius:4}}>{Math.round(m[k])}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={()=>deleteMeal(i)} style={{background:'none',border:'none',color:T.border2,fontSize:20,lineHeight:1,padding:'4px',flexShrink:0}}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>}

        {/* CHARTS */}
        {tab==='charts'&&(
          <div>
            {[{title:'Калории / день (норма 2000)',k:'cal',norm:2000,color:T.cal,warn:false},{title:'Насыщенные жиры (макс. 20г)',k:'sfat',norm:20,color:T.sfat,warn:true},{title:'Белки / день (норма 130г)',k:'prot',norm:130,color:T.prot,warn:false},{title:'Клетчатка / день (цель 30г)',k:'fiber',norm:30,color:T.fiber,warn:false}].map(({title,k,norm,color,warn})=>(
              <div key={k} style={card}>
                <div style={secTitle}>{title}</div>
                <BarChart values={dayTotals.map(t=>t[k])} norm={norm} color={color} warnOver={warn} labels={shortLabels}/>
              </div>
            ))}
            <div style={card}>
              <div style={secTitle}><span>💧</span>Вода за 7 дней (цель {WATER_GOAL})</div>
              <BarChart values={last7.map(d=>{const r=allData.find(x=>x.date===d);return r?.water||0;})} norm={WATER_GOAL} color={T.blue} warnOver={false} labels={shortLabels}/>
            </div>
          </div>
        )}

        {/* TIPS */}
        {tab==='tips'&&(
          <div>
            {[{title:'✓ Полезно при холестерине',color:T.green,items:tips_good},{title:'✗ Ограничить / исключить',color:T.red,items:tips_bad}].map(({title,color,items})=>(
              <div key={title} style={{...card,borderLeft:`4px solid ${color}`}}>
                <div style={{fontFamily:'sans-serif',fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color,marginBottom:12,fontWeight:600}}>{title}</div>
                {items.map((t,i)=><div key={i} style={{fontSize:13,lineHeight:1.7,padding:'5px 0',borderBottom:`1px solid ${T.border}`,color:T.text,display:'flex',gap:8,fontFamily:'sans-serif'}}><span style={{color,flexShrink:0}}>→</span>{t}</div>)}
              </div>
            ))}
            <div style={{...card,borderLeft:`4px solid ${T.accent}`}}>
              <div style={{fontFamily:'sans-serif',fontSize:10,letterSpacing:'0.12em',textTransform:'uppercase',color:T.accent,marginBottom:12,fontWeight:600}}>◈ Твои нормы</div>
              {[['Калории','~2000 ккал',T.cal],['Белки','130 г',T.prot],['Жиры','65 г',T.fat],['Углеводы','220 г',T.carb],['Клетчатка','≥30 г',T.fiber],['Насыщенные жиры','<20 г',T.sfat]].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:13,lineHeight:1.7,padding:'5px 0',borderBottom:`1px solid ${T.border}`,fontFamily:'sans-serif'}}>
                  <span style={{color:T.text2}}>{l}</span>
                  <span style={{background:c+'20',color:c,borderRadius:6,padding:'2px 8px',fontSize:12,fontWeight:600}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,background:T.header,borderTop:`1px solid ${T.border}`,display:'flex',paddingBottom:'env(safe-area-inset-bottom, 0px)',zIndex:100}}>
        {[['diary','📋','Дневник'],['charts','📊','График'],['tips','💡','Советы']].map(([t,icon,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,background:'none',border:'none',color:tab===t?T.accent:T.text2,padding:'10px 0 8px',fontFamily:'sans-serif',fontSize:10,letterSpacing:'0.06em',display:'flex',flexDirection:'column',alignItems:'center',gap:3,transition:'color 0.2s',textTransform:'uppercase'}}>
            <span style={{fontSize:20}}>{icon}</span>{label}
          </button>
        ))}
      </div>
    </div>
  );
}
