-- Rollback for 20261111120000_gogo_traveller_profiles.sql. Deletes every saved traveller profile.
-- After rollback the app falls back to asking for details (and to the 24-hour reuse), with no code change.
drop table if exists public.gogo_traveller_profiles;
