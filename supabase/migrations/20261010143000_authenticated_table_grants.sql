grant usage on schema public to authenticated;

grant select, insert, update, delete
on table public.profiles
to authenticated;

grant select, insert, update, delete
on table public.preferences
to authenticated;

grant select, insert, update, delete
on table public.analysis_history
to authenticated;
