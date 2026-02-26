import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ildwctveuhbaftxevrnt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZHdjdHZldWhiYWZ0eGV2cm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDA5MjIsImV4cCI6MjA4NzcxNjkyMn0.GL9BLTlmsc4Kt5ByWD4QOiPcP7aCnVC9XiP-M2yQLI8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Simple user id stored in localStorage (no auth needed)
export function getUserId() {
  let uid = localStorage.getItem('diary_uid');
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).substr(2, 12);
    localStorage.setItem('diary_uid', uid);
  }
  return uid;
}

export async function getDayData(date) {
  const uid = getUserId();
  const { data } = await supabase
    .from('diary_data')
    .select('*')
    .eq('user_id', uid)
    .eq('date', date)
    .single();
  return data || { meals: [], water: 0, mood: null, mood_note: '', ai_rec: null };
}

export async function saveDayData(date, fields) {
  const uid = getUserId();
  const { error } = await supabase
    .from('diary_data')
    .upsert({ user_id: uid, date, updated_at: new Date().toISOString(), ...fields },
      { onConflict: 'user_id,date' });
  if (error) console.error('Supabase save error:', error);
}

export async function getAllData() {
  const uid = getUserId();
  const { data } = await supabase
    .from('diary_data')
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: false })
    .limit(30);
  return data || [];
}
