create table if not exists public.mindcare_users (
  id uuid primary key,
  firebase_id text,
  public_chat_id text not null unique,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.mindcare_direct_messages (
  id uuid primary key,
  conversation_key text not null,
  mode text not null check (mode in ('friend', 'therapist')),
  from_id uuid not null references public.mindcare_users(id) on delete cascade,
  from_chat_id text not null,
  from_name text not null,
  to_id uuid not null references public.mindcare_users(id) on delete cascade,
  to_chat_id text not null,
  text text not null default '',
  attachment jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mindcare_users_chat_id_idx on public.mindcare_users(public_chat_id);
create index if not exists mindcare_users_email_idx on public.mindcare_users(email);
create index if not exists mindcare_direct_messages_conversation_idx on public.mindcare_direct_messages(conversation_key, created_at);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mindcare_direct_messages'
  ) then
    alter publication supabase_realtime add table public.mindcare_direct_messages;
  end if;
end $$;

alter table public.mindcare_users disable row level security;
alter table public.mindcare_direct_messages disable row level security;
