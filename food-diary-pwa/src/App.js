import { useState, useEffect, useCallback, useRef } from 'react';
import { getDayData, saveDayData, getAllData, getBloodTests, saveBloodTest, deleteBloodTest, getWeightLog, saveWeight, deleteWeight } from './supabase';

const ACTIVITY_LEVELS = {
  rest:  { label: '🧘 Обычный день', cal: 2000, prot: 130, fat: 65, carb: 220, fiber: 30, sfat: 20 },
  walk:  { label: '🚶 Прогулка',     cal: 2200, prot: 135, fat: 70, carb: 250, fiber: 30, sfat: 20 },
  sport: { label: '🎾 Спорт',        cal: 2500, prot: 155, fat: 80, carb: 290, fiber: 30, sfat: 20 },
};
function getNorms(activity) { return ACTIVITY_LEVELS[activity] || ACTIVITY_LEVELS.rest; }
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
  const [dayData, setDayData] = useState({ meals: [], water: 0, mood: null, mood_note: '', ai_rec: null, activity: 'rest' });
  const [allData, setAllData] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [chartRange, setChartRange] = useState('7d');
  const [bloodTests, setBloodTests] = useState([]);
  const [weightLog, setWeightLog] = useState([]);
  const [newTest, setNewTest] = useState({ date: todayStr(), total_chol:'', ldl:'', hdl:'', triglycerides:'', notes:'' });
  const [newWeight, setNewWeight] = useState({ date: todayStr(), weight:'' });
  const [healthTab, setHealthTab] = useState('weight'); // 'weight' | 'blood' // '7d' | '4w'
  const fileRef = useRef();
  const T = dark ? LC.dark : LC.light;

  const loadDay = useCallback(async (d) => {
    setSyncing(true);
    const data = await getDayData(d);
    setDayData({ meals: data.meals || [], water: data.water || 0, mood: data.mood || null, mood_note: data.mood_note || '', ai_rec: data.ai_rec || null, activity: data.activity || 'rest' });
    setSyncing(false);
  }, []);

  const loadAll = useCallback(async () => {
    const rows = await getAllData(); setAllData(rows);
  }, []);

  useEffect(() => { loadDay(date); }, [date, loadDay]);
  useEffect(() => { if (tab === 'charts') loadAll(); }, [tab, loadAll]);
  useEffect(() => {
    if (tab === 'health') {
      getBloodTests().then(setBloodTests);
      getWeightLog().then(setWeightLog);
    }
  }, [tab]);

  async function updateDay(fields) {
    const updated = { ...dayData, ...fields };
    setDayData(updated);
    await saveDayData(date, { meals: updated.meals, water: updated.water, mood: updated.mood, mood_note: updated.mood_note, ai_rec: updated.ai_rec, activity: updated.activity || 'rest' });
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
      const NORMS = getNorms(dayData.activity); const rem = { cal: Math.round(NORMS.cal-t.cal), prot: Math.round(NORMS.prot-t.prot), carb: Math.round(NORMS.carb-t.carb), fiber: Math.round(NORMS.fiber-t.fiber) };
      const prompt = 'Пользователь ведёт дневник питания. Цели: снизить холестерин, похудеть.
' +
        'Съедено за день: ' + meals.map(m=>m.name).join(', ') + '
' +
        'Итого: ' + Math.round(t.cal) + ' ккал, белки ' + Math.round(t.prot) + 'г, жиры ' + Math.round(t.fat) + 'г, углеводы ' + Math.round(t.carb) + 'г, клетчатка ' + Math.round(t.fiber) + 'г, нас.жиры ' + Math.round(t.sfat) + 'г.
' +
        'До нормы осталось: ' + (rem.cal>0?rem.cal+' ккал':'калории закрыты') + ', белки ' + (rem.prot>0?rem.prot+'г':'норма') + ', углеводы ' + (rem.carb>0?rem.carb+'г':'норма') + ', клетчатка ' + (rem.fiber>0?rem.fiber+'г':'норма') + '.

' +
        'В поле add предлагай конкретные блюда с граммами и ккал, например: греческий йогурт 150г (~100 ккал, 15г белка). Выбирай продукты полезные при холестерине.
' +
        'В поле avoid пиши конкретно что стоит избежать исходя из уже съеденного сегодня.
' +
        'В поле tip — главный вывод по дню в 1 предложении.

' +
        'ТОЛЬКО JSON без markdown:
{"avoid":["макс 3 конкретных пункта"],"add":["макс 3 конкретных блюда с граммами и ккал"],"tip":"вывод до 90 символов"}';
      let text = await callClaude([{ role: 'user', content: prompt }], 800);
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
        ai_rec: rec,
        activity: current.activity || 'rest'
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
  function getDayTotals(dateStr) {
    const row = allData.find(r => r.date === dateStr);
    const ms = row?.meals || [];
    return ms.reduce((a,m)=>{for(const k in a)a[k]+=parseFloat(m[k])||0;return a;},{cal:0,prot:0,fat:0,carb:0,fiber:0,sfat:0});
  }
  // Dynamic range
  function getChartDates() {
    if (chartRange === '4w') {
      return Array.from({length:4},(_,i)=>{
        const end=new Date(); end.setDate(end.getDate()-(3-i)*7);
        const start=new Date(end); start.setDate(start.getDate()-6);
        const days=Array.from({length:7},(_,j)=>{const d=new Date(start);d.setDate(d.getDate()+j);return d.toISOString().split('T')[0];});
        return { label: start.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}), days };
      });
    }
    return last7.map(d=>({ label: new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'numeric'}), days:[d] }));
  }
  const chartDates = getChartDates();
  const chartLabels = chartDates.map(p=>p.label);
  function getChartValues(k) {
    const NORMS_chart = getNorms(dayData.activity);
    return chartDates.map(p=>{
      const total = p.days.reduce((sum,d)=>{
        const t=getDayTotals(d); return sum+(t[k]||0);
      },0);
      const avg = total / p.days.filter(d=>allData.find(r=>r.date===d)).length || 0;
      const norm = k==='water' ? WATER_GOAL : NORMS_chart[k];
      return norm>0 ? Math.round((avg/norm)*100) : 0;
    });
  }
  const dayTotals = last7.map(d=>getDayTotals(d));

  const tips_good=['Овсянка, ячмень — бета-глюкан снижает ЛПНП','Жирная рыба (скумбрия, лосось) — омега-3','Грецкие орехи, миндаль — 30г в день','Оливковое масло первого отжима','Авокадо — мононенасыщенные жиры','Бобовые (чечевица, нут) — клетчатка + белок','Чеснок — снижает холестерин','Яблоки, груши, цитрусовые — пектин','Зелёный чай — полифенолы EGCG'];
  const tips_bad=['Красное мясо — не более 2 раз в нед.','Колбасы, сосиски, полуфабрикаты','Сливочное масло, сало','Жирные сливки, сметана, майонез','Трансжиры: маргарин, выпечка, фастфуд','Кокосовое и пальмовое масло','Белый хлеб, сахар, сладкое','Алкоголь — повышает триглицериды'];

  function PctBar({pcts,color,warnOver,labels}) {
    // pcts are 0-150+ percent of norm
    const max=Math.max(130,...pcts,1);
    return(
      <div style={{display:'flex',alignItems:'flex-end',gap:4,height:100,position:'relative',paddingBottom:18}}>
        {/* 100% norm line */}
        <div style={{position:'absolute',bottom:18+(100/max)*72,left:0,right:0,borderTop:`1.5px dashed ${T.border2}`,zIndex:1}}/>
        <div style={{position:'absolute',bottom:18+(100/max)*72-10,right:2,fontFamily:'sans-serif',fontSize:8,color:T.text3}}>100%</div>
        {pcts.map((v,i)=>{
          const h=Math.max(v>0?3:1,(v/max)*72);const over=warnOver&&v>100;const empty=v===0;
          return(<div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
            <div style={{position:'absolute',bottom:18,width:'75%',height:h,background:empty?T.border:over?T.red:color,borderRadius:'3px 3px 0 0',opacity:empty?0.3:0.85,transition:'height 0.4s'}}/>
            {v>0&&<div style={{position:'absolute',bottom:18+h+2,fontFamily:'sans-serif',fontSize:8,color:over?T.red:color,fontWeight:600,whiteSpace:'nowrap'}}>{v}%</div>}
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
              const NORMS=getNorms(dayData.activity); const val=totals[k],norm=NORMS[k],pct=(val/norm)*100,over=warn&&val>norm,color=T[k];
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

          {/* Water + Activity */}
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
              <div style={secTitle}><span>🏃</span>Активность</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {Object.entries(ACTIVITY_LEVELS).map(([key,lvl])=>(
                  <button key={key} onClick={()=>updateDay({activity:key})} style={{background:dayData.activity===key?T.accent+'18':'transparent',border:`1px solid ${dayData.activity===key?T.accent:T.border}`,color:dayData.activity===key?T.accent:T.text2,padding:'8px 10px',fontFamily:'sans-serif',fontSize:12,borderRadius:10,cursor:'pointer',transition:'all 0.2s',textAlign:'left',fontWeight:dayData.activity===key?600:400}}>{lvl.label}</button>
                ))}
              </div>
              <div style={{fontFamily:'sans-serif',fontSize:10,color:T.text3,marginTop:8,textAlign:'center'}}>
                норма: {getNorms(dayData.activity).cal} ккал / {getNorms(dayData.activity).prot}г белка
              </div>
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
            {/* Timeframe switcher */}
            <div style={{display:'flex',gap:8,marginBottom:14,justifyContent:'flex-end'}}>
              {[['7d','7 дней'],['4w','4 недели']].map(([v,l])=>(
                <button key={v} onClick={()=>setChartRange(v)} style={{background:chartRange===v?T.accent:'transparent',border:`1px solid ${chartRange===v?T.accent:T.border2}`,color:chartRange===v?'#fff':T.text2,padding:'6px 14px',fontFamily:'sans-serif',fontSize:11,borderRadius:20,transition:'all 0.2s',letterSpacing:'0.06em'}}>{l}</button>
              ))}
            </div>
            {[{title:'Калории (% от нормы)',k:'cal',color:T.cal,warn:false},{title:'Насыщенные жиры (% от макс.)',k:'sfat',color:T.sfat,warn:true},{title:'Белки (% от нормы)',k:'prot',color:T.prot,warn:false},{title:'Клетчатка (% от цели)',k:'fiber',color:T.fiber,warn:false}].map(({title,k,color,warn})=>(
              <div key={k} style={card}>
                <div style={secTitle}>{title}</div>
                <PctBar pcts={getChartValues(k)} color={color} warnOver={warn} labels={chartLabels}/>
              </div>
            ))}
            <div style={card}>
              <div style={secTitle}><span>💧</span>Вода (% от цели {WATER_GOAL} стак.)</div>
              <PctBar pcts={getChartValues('water')} color={T.blue} warnOver={false} labels={chartLabels}/>
            </div>
          </div>
        )}

        {/* HEALTH */}
        {tab==='health'&&(
          <div>
            {/* Sub tabs */}
            <div style={{display:'flex',gap:8,marginBottom:14}}>
              {[['weight','⚖️ Вес'],['blood','🩸 Анализы']].map(([k,l])=>(
                <button key={k} onClick={()=>setHealthTab(k)} style={{flex:1,background:healthTab===k?T.accent:'transparent',border:`1px solid ${healthTab===k?T.accent:T.border2}`,color:healthTab===k?'#fff':T.text2,padding:'9px',fontFamily:'sans-serif',fontSize:12,borderRadius:12,transition:'all 0.2s',fontWeight:healthTab===k?600:400}}>{l}</button>
              ))}
            </div>

            {/* WEIGHT */}
            {healthTab==='weight'&&<>
              {/* Add weight */}
              <div style={card}>
                <div style={secTitle}><span>⚖️</span>Добавить вес</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                  <div>
                    <div style={{fontFamily:'sans-serif',fontSize:10,color:T.text2,marginBottom:4,letterSpacing:'0.08em',textTransform:'uppercase'}}>Дата</div>
                    <input type="date" value={newWeight.date} onChange={e=>setNewWeight(p=>({...p,date:e.target.value}))}
                      style={{width:'100%',background:T.bg3,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px',fontFamily:'sans-serif',fontSize:13,color:T.text,boxSizing:'border-box'}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:'sans-serif',fontSize:10,color:T.text2,marginBottom:4,letterSpacing:'0.08em',textTransform:'uppercase'}}>Вес (кг)</div>
                    <input type="number" step="0.1" placeholder="85.0" value={newWeight.weight} onChange={e=>setNewWeight(p=>({...p,weight:e.target.value}))}
                      style={{width:'100%',background:T.bg3,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px',fontFamily:'sans-serif',fontSize:13,color:T.text,boxSizing:'border-box'}}/>
                  </div>
                </div>
                <button onClick={async()=>{if(!newWeight.weight)return;await saveWeight(newWeight.date,parseFloat(newWeight.weight));const wl=await getWeightLog();setWeightLog(wl);setNewWeight({date:todayStr(),weight:''}); }} style={{width:'100%',background:T.green,border:'none',color:'#fff',padding:'10px',fontFamily:'sans-serif',fontSize:12,letterSpacing:'0.08em',textTransform:'uppercase',borderRadius:10,fontWeight:600}}>Сохранить</button>
              </div>

              {/* Weight chart */}
              {weightLog.length>0&&<div style={card}>
                <div style={secTitle}><span>📈</span>Динамика веса</div>
                {(()=>{
                  const last=weightLog[weightLog.length-1]?.weight;
                  const first=weightLog[0]?.weight;
                  const diff=last&&first?Math.round((last-first)*10)/10:0;
                  return <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
                    <div style={{background:T.bg3,borderRadius:10,padding:'10px 14px',flex:1,textAlign:'center'}}>
                      <div style={{fontFamily:'sans-serif',fontSize:9,color:T.text2,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>Сейчас</div>
                      <div style={{fontSize:22,fontWeight:700,color:T.accent,fontFamily:'sans-serif'}}>{last} кг</div>
                    </div>
                    {diff!==0&&<div style={{background:T.bg3,borderRadius:10,padding:'10px 14px',flex:1,textAlign:'center'}}>
                      <div style={{fontFamily:'sans-serif',fontSize:9,color:T.text2,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:4}}>За период</div>
                      <div style={{fontSize:22,fontWeight:700,color:diff<0?T.green:T.red,fontFamily:'sans-serif'}}>{diff>0?'+':''}{diff} кг</div>
                    </div>}
                  </div>;
                })()}
                {/* Mini line chart */}
                <div style={{display:'flex',alignItems:'flex-end',gap:3,height:80,position:'relative',paddingBottom:16}}>
                  {(()=>{
                    const vals=weightLog.map(w=>w.weight);
                    const mn=Math.min(...vals)-1, mx=Math.max(...vals)+1, range=mx-mn;
                    return weightLog.map((w,i)=>{
                      const h=((w.weight-mn)/range)*60;
                      const label=new Date(w.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'numeric'});
                      const showLabel=weightLog.length<=8||i%Math.ceil(weightLog.length/6)===0||i===weightLog.length-1;
                      return <div key={i} style={{flex:1,position:'relative',display:'flex',flexDirection:'column',alignItems:'center'}}>
                        <div style={{position:'absolute',bottom:16,width:'70%',minHeight:3,height:h,background:T.blue,borderRadius:'3px 3px 0 0',opacity:0.8}}/>
                        <div style={{position:'absolute',bottom:16+h+2,fontFamily:'sans-serif',fontSize:8,color:T.blue,fontWeight:600,whiteSpace:'nowrap'}}>{w.weight}</div>
                        {showLabel&&<div style={{position:'absolute',bottom:0,fontFamily:'sans-serif',fontSize:7,color:T.text3,whiteSpace:'nowrap'}}>{label}</div>}
                      </div>;
                    });
                  })()}
                </div>
              </div>}

              {/* Weight log list */}
              {weightLog.length>0&&<div style={card}>
                <div style={secTitle}><span>📋</span>История</div>
                {[...weightLog].reverse().slice(0,10).map((w,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${T.border}`}}>
                    <div style={{flex:1}}>
                      <span style={{fontFamily:'sans-serif',fontSize:13,color:T.text,fontWeight:600}}>{w.weight} кг</span>
                      <span style={{fontFamily:'sans-serif',fontSize:11,color:T.text3,marginLeft:10}}>{new Date(w.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</span>
                    </div>
                    <button onClick={async()=>{await deleteWeight(w.id);const wl=await getWeightLog();setWeightLog(wl);}} style={{background:'none',border:'none',color:T.border2,fontSize:18,padding:'2px 4px'}}>×</button>
                  </div>
                ))}
              </div>}
            </>}

            {/* BLOOD TESTS */}
            {healthTab==='blood'&&<>
              {/* Your history */}
              <div style={{...card,borderLeft:`4px solid ${T.red}`,marginBottom:14}}>
                <div style={secTitle}><span>📊</span>Твоя история холестерина</div>
                {[
                  {date:'17.03.2023',total:265.8,ldl:184.6,hdl:59.9,tri:106.6},
                  {date:'02.07.2024',total:254,ldl:177,hdl:57,tri:102},
                  {date:'19.06.2025',total:236,ldl:169,hdl:55,tri:61},
                  {date:'24.02.2026',total:276,ldl:206,hdl:55,tri:75},
                  ...bloodTests.map(t=>({date:new Date(t.date+'T12:00:00').toLocaleDateString('ru-RU'),total:t.total_chol,ldl:t.ldl,hdl:t.hdl,tri:t.triglycerides,id:t.id,custom:true}))
                ].map((t,i,arr)=>{
                  const prev=arr[i-1];
                  const ldlDiff=prev&&t.ldl&&prev.ldl?Math.round((t.ldl-prev.ldl)*10)/10:null;
                  return(
                    <div key={i} style={{padding:'10px 0',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'flex-start',gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                          <span style={{fontFamily:'sans-serif',fontSize:11,color:T.text2}}>{t.date}</span>
                          {ldlDiff!==null&&<span style={{fontFamily:'sans-serif',fontSize:10,fontWeight:600,color:ldlDiff<0?T.green:T.red}}>{ldlDiff<0?'↓':'↑'} LDL {Math.abs(ldlDiff)}</span>}
                        </div>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          {[['Общий',t.total,200,T.cal],['LDL',t.ldl,120,T.red],['HDL',t.hdl,null,T.green],['Тригл.',t.tri,150,T.carb]].map(([l,v,max,c])=>
                            v?<span key={l} style={{fontFamily:'sans-serif',fontSize:11,color:max&&v>max?T.red:c,background:(max&&v>max?T.red:c)+'15',padding:'2px 7px',borderRadius:6,fontWeight:600}}>{l}: {v}</span>:null
                          )}
                        </div>
                      </div>
                      {t.custom&&<button onClick={async()=>{await deleteBloodTest(t.id);const bt=await getBloodTests();setBloodTests(bt);}} style={{background:'none',border:'none',color:T.border2,fontSize:18,padding:'2px'}}>×</button>}
                    </div>
                  );
                })}
              </div>

              {/* Add new test */}
              <div style={card}>
                <div style={secTitle}><span>➕</span>Добавить анализ</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                  {[['date','Дата','date',null],['total_chol','Общий хол.','number','< 200'],['ldl','LDL (плохой)','number','< 120'],['hdl','HDL (хороший)','number','> 35'],['triglycerides','Триглицериды','number','< 150'],['notes','Заметки','text',null]].map(([k,l,type,hint])=>(
                    <div key={k} style={k==='notes'?{gridColumn:'1/-1'}:{}}>
                      <div style={{fontFamily:'sans-serif',fontSize:10,color:T.text2,marginBottom:4,letterSpacing:'0.08em',textTransform:'uppercase'}}>{l}{hint&&<span style={{color:T.text3,marginLeft:4,fontSize:9}}>({hint})</span>}</div>
                      <input type={type} value={newTest[k]} onChange={e=>setNewTest(p=>({...p,[k]:e.target.value}))}
                        style={{width:'100%',background:T.bg3,border:`1px solid ${T.border}`,borderRadius:8,padding:'8px',fontFamily:'sans-serif',fontSize:13,color:T.text,boxSizing:'border-box'}}/>
                    </div>
                  ))}
                </div>
                <button onClick={async()=>{
                  if(!newTest.total_chol&&!newTest.ldl)return;
                  await saveBloodTest({date:newTest.date,total_chol:newTest.total_chol?parseFloat(newTest.total_chol):null,ldl:newTest.ldl?parseFloat(newTest.ldl):null,hdl:newTest.hdl?parseFloat(newTest.hdl):null,triglycerides:newTest.triglycerides?parseFloat(newTest.triglycerides):null,notes:newTest.notes});
                  const bt=await getBloodTests();setBloodTests(bt);
                  setNewTest({date:todayStr(),total_chol:'',ldl:'',hdl:'',triglycerides:'',notes:''});
                }} style={{width:'100%',background:T.red,border:'none',color:'#fff',padding:'10px',fontFamily:'sans-serif',fontSize:12,letterSpacing:'0.08em',textTransform:'uppercase',borderRadius:10,fontWeight:600}}>Сохранить анализ</button>
              </div>

              {/* Norms reference */}
              <div style={{...card,borderLeft:`4px solid ${T.green}`}}>
                <div style={secTitle}><span>📌</span>Нормы</div>
                {[['Общий холестерин','< 200 mg/dL',T.cal],['LDL (плохой)','< 120 mg/dL',T.red],['HDL (хороший)','>  35 mg/dL',T.green],['Триглицериды','< 150 mg/dL',T.blue]].map(([l,v,c])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${T.border}`,fontFamily:'sans-serif',fontSize:13}}>
                    <span style={{color:T.text2}}>{l}</span>
                    <span style={{color:c,fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
            </>}
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
        {[['diary','📋','Дневник'],['charts','📊','График'],['health','❤️','Здоровье'],['tips','💡','Советы']].map(([t,icon,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,background:'none',border:'none',color:tab===t?T.accent:T.text2,padding:'10px 0 8px',fontFamily:'sans-serif',fontSize:10,letterSpacing:'0.06em',display:'flex',flexDirection:'column',alignItems:'center',gap:3,transition:'color 0.2s',textTransform:'uppercase'}}>
            <span style={{fontSize:20}}>{icon}</span>{label}
          </button>
        ))}
      </div>
    </div>
  );
}
