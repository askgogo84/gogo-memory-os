-- Rollback for 20261108130000_gogo_spaces.sql: drops only the two Spaces tables.
drop table if exists public.space_versions;
drop table if exists public.spaces;
