import { createClient } from '@supabase/supabase-js';

let supabaseClient;

export function getSupabaseClient() {
	if (supabaseClient) return supabaseClient;

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error('Supabase is not configured. Add the project URL and anon key to .env.local.');
	}

	supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
	return supabaseClient;
}