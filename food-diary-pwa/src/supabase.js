import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ildwctveuhbaftxevrnt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsZHdjdHZldWhiYWZ0eGV2cm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDA5MjIsImV4cCI6MjA4NzcxNjkyMn0.GL9BLTlmsc4Kt5ByWD4QOiPcP7aCnVC9XiP-M2yQLI8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Auth
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) console.error('Google sign in error:', error);
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

export function getUserId(session) {
  if (session?.user?.id) return session.user.id;
  // fallback to localStorage for backward compat
  let uid = localStorage.getItem('diary_uid');
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).substr(2, 12);
    localStorage.setItem('diary_uid', uid);
  }
  return uid;
}

export async function getDayData(date, session) {
  const uid = getUserId(session);
  const { data } = await supabase
    .from('diary_data')
    .select('*')
    .eq('user_id', uid)
    .eq('date', date)
    .single();
  return data || { meals: [], water: 0, mood: null, mood_note: '', ai_rec: null };
}

export async function saveDayData(date, fields, session) {
  const uid = getUserId(session);
  const { error } = await supabase
    .from('diary_data')
    .upsert({ user_id: uid, date, updated_at: new Date().toISOString(), ...fields },
      { onConflict: 'user_id,date' });
  if (error) console.error('Supabase save error:', error);
}

export async function getAllData(session) {
  const uid = getUserId(session);
  const { data } = await supabase
    .from('diary_data')
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: false })
    .limit(30);
  return data || [];
}

// Blood tests
export async function getBloodTests(session) {
  const uid = getUserId(session);
  const { data } = await supabase
    .from('blood_tests')
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: true });
  return data || [];
}

export async function saveBloodTest(record, session) {
  const uid = getUserId(session);
  const { error } = await supabase
    .from('blood_tests')
    .insert({ user_id: uid, ...record });
  if (error) console.error('Blood test save error:', error);
}

export async function deleteBloodTest(id) {
  const { error } = await supabase.from('blood_tests').delete().eq('id', id);
  if (error) console.error('Blood test delete error:', error);
}

// Weight log
export async function getWeightLog(session) {
  const uid = getUserId(session);
  const { data } = await supabase
    .from('weight_log')
    .select('*')
    .eq('user_id', uid)
    .order('date', { ascending: true });
  return data || [];
}

export async function saveWeight(date, weight, session) {
  const uid = getUserId(session);
  const { error } = await supabase
    .from('weight_log')
    .upsert({ user_id: uid, date, weight }, { onConflict: 'user_id,date' });
  if (error) console.error('Weight save error:', error);
}

export async function deleteWeight(id) {
  const { error } = await supabase.from('weight_log').delete().eq('id', id);
  if (error) console.error('Weight delete error:', error);
}
