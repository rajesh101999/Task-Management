/* supabaseClient.js — one shared Supabase client for the whole app.
   SUPABASE_ANON_KEY is meant to be public: it only grants whatever the
   database's Row Level Security policies allow (see the SQL migration
   under docs/ or the project's setup notes). Never put the "service_role"
   key here or anywhere in client-side code. */

const SUPABASE_URL = 'https://kcjvcxbxciwwqwtwuhkx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjanZjeGJ4Y2l3d3F3dHd1aGt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MjM3OTMsImV4cCI6MjEwMTQ5OTc5M30.raVHQzDJb-HSvcniJjEgSF9AE6eWTE1asbW539929EU';

// `sb` is the shared client every page uses for its own session.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
