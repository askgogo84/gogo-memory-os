-- Phase 1E/#20: custom briefing content flags
alter table users add column if not exists briefing_content text default 'default';
