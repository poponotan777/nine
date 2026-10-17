-- =====================================================================
-- オウダン v24:補完を「売れる商品」に集中+ランキング下位が増え続けないようにする
--   v18 の後に SQL Editor へ全部貼り付けて Run 1回。何度流しても安全です。
--
--   1) 他サイトで探す(補完)のは次の商品だけ
--        ・有名ブランドの商品
--        ・どこかのサイトのランキングで300位以内(今日・最近)
--        ・まとめ(/c)に入っている商品
--      → 301〜1000位だけの商品は「そのサイトの価格」は記録するが、他サイトでは探さない
--   2) 古い商品の自動削除(毎日4:30)を3段階に
--        ・ランキング圏外になった下位の商品(ブランドでない・1サイトだけ・300位以内に入ったことがない)
--          → 圏外になって3日で削除
--        ・300位以内に入ったことがある/2サイト以上で比べられる/有名ブランド → 45日見かけなければ削除(今までどおり)
--        ・まとめに入っている商品 → 消さない
--      さらに安全装置として、商品が15万件を超えたら、価値の低い古いものから削除
-- =====================================================================

alter table public.products add column if not exists top_day date;   -- 最後に300位以内だった日
create index if not exists products_top_idx on public.products (top_day);

-- 補完の対象かどうか
create or replace function public.fill_worthy(_pkey text, _max_rank integer default 300)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.products p
     where p.pkey = _pkey and p.merged_into is null
       and (p.is_brand
            or p.pop <= _max_rank
            or p.top_day >= (now() at time zone 'Asia/Tokyo')::date - 7
            or (to_regclass('public.collection_items') is not null
                and exists (select 1 from public.collection_items ci where ci.product_key = p.pkey)))
  );
$$;
revoke execute on function public.fill_worthy(text, integer) from public, anon, authenticated;
grant  execute on function public.fill_worthy(text, integer) to service_role;


create or replace function public.enqueue_missing(_limit integer default 20000, _max_rank integer default 300)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n1 integer; n2 integer; today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  -- 今300位以内の商品に「300位以内だった日」を記録
  update public.products set top_day = today
   where merged_into is null and pop <= _max_rank and top_day is distinct from today;

  -- 統合済み・削除済み・対象外(下位だけ)の商品は予約から外す
  delete from public.fill_queue q
   where not exists (select 1 from public.products p where p.pkey = q.pkey and p.merged_into is null)
      or not public.fill_worthy(q.pkey, _max_rank);

  -- 他サイトにまだ無い商品(対象だけ)。人気順・ブランド優先
  insert into public.fill_queue (pkey, store, prio)
  select p.pkey, s.store, coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end
    from public.products p
    cross join (values ('rakuten'), ('yahoo'), ('amazon')) as s(store)
   where p.merged_into is null
     and p.last_seen >= today - 7
     and (p.is_brand or p.pop <= _max_rank or p.top_day >= today - 7)
     and not exists (select 1 from public.offers o where o.pkey = p.pkey and o.store = s.store)
   order by coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end
   limit _limit
  on conflict (pkey, store) do nothing;
  get diagnostics n1 = row_count;

  -- 3日以上更新されていない価格の取り直し(対象だけ)
  insert into public.fill_queue (pkey, store, prio)
  select o.pkey, o.store, coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end + 5000
    from public.offers o
    join public.products p on p.pkey = o.pkey
   where p.merged_into is null
     and o.updated_at < now() - interval '3 days'
     and (p.is_brand or p.pop <= _max_rank or p.top_day >= today - 7)
   order by 3
   limit _limit
  on conflict (pkey, store) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- 古い1引数版は消して、新しい版だけにする(collector は _limit だけ渡す)
drop function if exists public.enqueue_missing(integer);
revoke execute on function public.enqueue_missing(integer, integer) from public, anon, authenticated;
grant  execute on function public.enqueue_missing(integer, integer) to service_role;


create or replace function public.prune_catalog()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d1 integer := 0; d2 integer := 0; d3 integer := 0; dlow integer := 0; dcap integer := 0;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  cap integer := 150000;
  total integer;
  has_ci boolean := to_regclass('public.collection_items') is not null;
begin
  drop table if exists _gone;
  create temp table _gone (pkey text primary key) on commit drop;

  -- ① 45日見かけなかった商品(まとめに入っているものは除く)
  insert into _gone
  select p.pkey from public.products p
   where p.merged_into is null and p.last_seen < today - 45
     and (not has_ci or not exists (select 1 from public.collection_items ci where ci.product_key = p.pkey))
  on conflict do nothing;

  -- ② ランキング下位だけの商品:圏外になって3日たったら削除
  insert into _gone
  select p.pkey from public.products p
   where p.merged_into is null
     and not p.is_brand
     and p.pop is null
     and p.last_seen < today - 3
     and (p.top_day is null or p.top_day < today - 30)
     and (select count(*) from public.offers o where o.pkey = p.pkey) <= 1
     and (not has_ci or not exists (select 1 from public.collection_items ci where ci.product_key = p.pkey))
  on conflict do nothing;
  get diagnostics dlow = row_count;

  -- ③ 安全装置:それでも15万件を超えていたら、価値の低い古いものから削除
  select count(*) into total from public.products where merged_into is null;
  total := total - (select count(*) from _gone);
  if total > cap then
    insert into _gone
    select p.pkey from public.products p
     where p.merged_into is null and not p.is_brand
       and not exists (select 1 from _gone g where g.pkey = p.pkey)
       and (not has_ci or not exists (select 1 from public.collection_items ci where ci.product_key = p.pkey))
     order by (p.top_day is not null) asc, p.pop desc nulls first, p.last_seen asc
     limit total - cap
    on conflict do nothing;
    get diagnostics dcap = row_count;
  end if;

  delete from public.offers o using _gone g where o.pkey = g.pkey;
  get diagnostics d1 = row_count;
  delete from public.products p using _gone g where p.pkey = g.pkey;
  get diagnostics d2 = row_count;
  -- 統合先が消えた転送用の行も消す
  delete from public.products p
   where p.merged_into is not null
     and not exists (select 1 from public.products t where t.pkey = p.merged_into);
  delete from public.fill_queue q where not exists (select 1 from public.products p where p.pkey = q.pkey);
  delete from public.collect_runs where started_at < now() - interval '90 days';
  get diagnostics d3 = row_count;
  return format('商品削除:%s(うち下位の圏外:%s・上限超え:%s) / 価格行削除:%s / 実行記録削除:%s', d2, dlow, dcap, d1, d3);
end $$;

revoke execute on function public.prune_catalog() from public, anon, authenticated;
grant  execute on function public.prune_catalog() to service_role;

-- 今の状態で一度だけ記録を付けてから、件数を表示
update public.products set top_day = (now() at time zone 'Asia/Tokyo')::date
 where merged_into is null and pop <= 300 and top_day is null;

select
  (select count(*) from public.products where merged_into is null)                         as "商品数",
  (select count(*) from public.products where merged_into is null and (is_brand or pop <= 300)) as "補完の対象",
  (select count(*) from public.fill_queue)                                                   as "補完待ち";
