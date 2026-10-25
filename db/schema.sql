-- A blog, the shape most applications read and write, and a wide table of the value types that
-- cost the most to decode.

create table users (
  id int8 generated always as identity primary key,
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table posts (
  id int8 generated always as identity primary key,
  author_id int8 not null references users (id),
  title text not null,
  body text not null,
  -- Null while the post is a draft.
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index posts_author_id on posts (author_id);
create index posts_published on posts (published_at desc, id desc) where published_at is not null;
create index posts_search on posts using gin (to_tsvector('english', title || ' ' || body));

create table comments (
  id int8 generated always as identity primary key,
  post_id int8 not null references posts (id),
  author_id int8 not null references users (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index comments_post_id on comments (post_id, id);
create index comments_author_id on comments (author_id);

create table tags (
  id int8 generated always as identity primary key,
  name text not null unique
);

create table post_tags (
  post_id int8 not null references posts (id),
  tag_id int8 not null references tags (id),
  primary key (post_id, tag_id)
);

create index post_tags_tag_id on post_tags (tag_id);

create table events (
  id int8 generated always as identity primary key,
  user_id int8 references users (id),
  kind text not null,
  amount numeric(12, 2),
  payload jsonb not null,
  labels text[] not null,
  happened_at timestamptz not null,
  succeeded boolean not null
);
