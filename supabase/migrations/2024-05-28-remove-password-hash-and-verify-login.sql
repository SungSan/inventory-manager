-- Remove password_hash usage and legacy password-based RPCs
alter table public.users drop column if exists password_hash;

-- Drop legacy login helpers that relied on password_hash
drop function if exists public.verify_login(text, text);
drop function if exists public.create_user(text, text, public.user_role);
