-- @name userById
select id, email, name, created_at
from users
where id = :id;

-- @name postsPage
select id, author_id, title, published_at
from posts
where published_at is not null
order by published_at desc, id desc
limit 20 offset :offset;

-- @name postsAfter
select id, author_id, title, published_at
from posts
where published_at is not null and (published_at, id) < (:publishedAt, :id)
order by published_at desc, id desc
limit 20;

-- @name postById
select id, title, body
from posts
where id = :id;

-- @name commentsOfPost
select id, author_id, body, created_at
from comments
where post_id = :postId
order by id;

-- @name postsWithTags
select p.id, p.title, coalesce(array_agg(t.name order by t.name) filter (where t.name is not null), '{}') as tags
from (
  select id, title, published_at
  from posts
  where published_at is not null
  order by published_at desc, id desc
  limit 20 offset :offset
) as p
left join post_tags pt on pt.post_id = p.id
left join tags t on t.id = pt.tag_id
group by p.id, p.title, p.published_at
order by p.published_at desc, p.id desc;

-- @name topAuthors
select u.id, u.name, count(p.id) as posts
from users u
join posts p on p.author_id = u.id
group by u.id
order by posts desc, u.id
limit :limit;

-- @name wideEvents
select id, user_id, kind, amount, payload, labels, happened_at, succeeded
from events
where id > :afterId
order by id
limit 10000;

-- @name insertUser
insert into users (email, name)
values (:email, :name)
returning id;

-- @name insertComments
insert into comments (post_id, author_id, body)
select * from unnest(:postIds::int8[], :authorIds::int8[], :bodies::text[]);

-- @name updatePostTitle
update posts
set title = :title
where id = :id;

-- @name upsertTag
insert into tags (name)
values (:name)
on conflict (name) do update set name = excluded.name
returning id;

-- @name searchPosts
select id, title
from posts
where published_at is not null
  and to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', :query)
order by id
limit 20;
