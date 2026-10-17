-- =====================================================================
-- オウダン 新プロジェクト用 一括セットアップSQL(v17)
--   新しく作ったSupabaseプロジェクトの SQL Editor に「全部貼り付けて Run 1回」。
--   これまでの supabase.sql + v5〜v13 の内容をすべて含みます(個別に流す必要なし)。
--   再実行しても安全です(if not exists / or replace)。
--
--   今回の改善点(容量パンク対策):
--   ・price_history は無駄な id 列をなくし、1行を小さくした
--   ・毎日 自動で古い価格履歴を削除(リスト登録・指値の商品は180日、それ以外は30日)
--   ・行数が上限(200万行)を超えたら、追跡していない商品の古い日から自動で削る
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 価格履歴(1商品×1ストア×1日で1行)
-- ---------------------------------------------------------------------
create table if not exists public.price_history (
  jan           text     not null,           -- JAN または r:/y:/a: のモールコード
  store         text     not null check (store in ('rakuten','yahoo','amazon')),
  price         integer  not null,
  recorded_at   date     not null,           -- JSTの日付
  slot          smallint not null default 0, -- 現在は1日1回なので常に0
  recorded_hour smallint,                    -- 最安を観測した時刻(JST, 時のみ)
  amount        numeric,                     -- 将来用(容量)
  unit          text,                        -- 将来用(単位)
  primary key (jan, store, recorded_at, slot)
);

-- 期間で古い順に消すときに使う
create index if not exists price_history_day_idx on public.price_history (recorded_at);

alter table public.price_history enable row level security;
drop policy if exists "price_history_select_all" on public.price_history;
create policy "price_history_select_all" on public.price_history
  for select using (true);
-- 書き込みはサーバー(シークレットキー)からのみ。一般ユーザー向けの書き込みポリシーは付けない。

-- 同じ日に複数回記録が来たら「安いほう」を残すまとめ書き込み関数
create or replace function public.record_price_min(_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  insert into public.price_history (jan, store, price, recorded_at, slot, recorded_hour)
  -- 同じ商品が1回の送信に複数含まれても失敗しないよう、最安の1件に絞ってから書く
  select distinct on (jan, store, recorded_at, slot)
    jan, store, price, recorded_at, slot, hr
  from (
    select
      r->>'jan' as jan,
      r->>'store' as store,
      (r->>'price')::integer as price,
      (r->>'recorded_at')::date as recorded_at,
      coalesce((r->>'slot')::smallint, 0) as slot,
      (r->>'hour')::smallint as hr
    from jsonb_array_elements(_rows) as r
    where (r->>'jan') is not null
      and (r->>'store') in ('rakuten','yahoo','amazon')
      and (r->>'price') ~ '^[0-9]+$'
  ) t
  order by jan, store, recorded_at, slot, price
  on conflict (jan, store, recorded_at, slot)
  do update set
    price = excluded.price,
    recorded_hour = excluded.recorded_hour
  where public.price_history.price > excluded.price;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.record_price_min(jsonb) from public, anon, authenticated;
grant  execute on function public.record_price_min(jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 2. お気に入りリスト(気になる / 定期購入)
-- ---------------------------------------------------------------------
create table if not exists public.wishlists (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jan        text not null,
  name       text,
  image      text,
  list_type  text not null default 'watch',   -- watch=気になる / rotation=定期購入
  base_price integer,                         -- 登録時の最安値
  track      boolean not null default false,  -- 毎日価格を更新する対象
  created_at timestamptz not null default now(),
  added_at   timestamptz not null default now(),
  unique (user_id, jan)
);
create index if not exists wishlists_jan_idx   on public.wishlists (jan);
create index if not exists wishlists_track_idx on public.wishlists (track) where track;

alter table public.wishlists enable row level security;
drop policy if exists "wishlists_select_own" on public.wishlists;
create policy "wishlists_select_own" on public.wishlists for select using (auth.uid() = user_id);
drop policy if exists "wishlists_insert_own" on public.wishlists;
create policy "wishlists_insert_own" on public.wishlists for insert with check (auth.uid() = user_id);
drop policy if exists "wishlists_update_own" on public.wishlists;
create policy "wishlists_update_own" on public.wishlists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "wishlists_delete_own" on public.wishlists;
create policy "wishlists_delete_own" on public.wishlists for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 3. 購入履歴(購入ボタンのクリック記録+節約額)
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jan        text,
  name       text,
  store      text,
  price      integer,
  savings    integer not null default 0,
  purchased  boolean not null default false,
  clicked_at timestamptz not null default now()
);
create index if not exists purchases_user_idx on public.purchases (user_id, clicked_at desc);

alter table public.purchases enable row level security;
drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own" on public.purchases for select using (auth.uid() = user_id);
drop policy if exists "purchases_insert_own" on public.purchases;
create policy "purchases_insert_own" on public.purchases for insert with check (auth.uid() = user_id);
drop policy if exists "purchases_update_own" on public.purchases;
create policy "purchases_update_own" on public.purchases for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "purchases_delete_own" on public.purchases;
create policy "purchases_delete_own" on public.purchases for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 4. レビュー(品質・使いやすさ・コスパの3軸。1人1商品1件、編集可)
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jan          text not null,
  product_name text,
  quality      smallint check (quality between 1 and 5),
  usability    smallint check (usability between 1 and 5),
  cospa        smallint check (cospa between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  unique (user_id, jan)
);
create index if not exists reviews_jan_idx on public.reviews (jan, created_at desc);

alter table public.reviews enable row level security;
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews for select using (true);
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews for insert with check (auth.uid() = user_id);
drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 5. オウダンポイント(同じ理由キーには二重付与しない)
-- ---------------------------------------------------------------------
create table if not exists public.points (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount     integer not null,
  reason_key text not null,   -- 例: daily:2026-10-13 / review:<jan> / purchase:<id>
  label      text,
  created_at timestamptz not null default now(),
  unique (user_id, reason_key)
);

alter table public.points enable row level security;
drop policy if exists "points_select_own" on public.points;
create policy "points_select_own" on public.points for select using (auth.uid() = user_id);
drop policy if exists "points_insert_own" on public.points;
create policy "points_insert_own" on public.points for insert with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 6. セール情報(書き込みは管理画面=サーバーからのみ。閲覧は全員)
-- ---------------------------------------------------------------------
create table if not exists public.sale_events (
  id          bigint generated always as identity primary key,
  name        text not null,
  store       text,
  start_date  date,
  end_date    date,
  url         text,
  status      text,
  period_text text,
  summary     text,
  created_at  timestamptz not null default now()
);

alter table public.sale_events enable row level security;
drop policy if exists "sale_events_select_all" on public.sale_events;
create policy "sale_events_select_all" on public.sale_events for select using (true);


-- ---------------------------------------------------------------------
-- 7. JAN紐付けの協力データ
-- ---------------------------------------------------------------------
create table if not exists public.product_links (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  jan         text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, product_key)
);

alter table public.product_links enable row level security;
drop policy if exists "product_links_select_all" on public.product_links;
create policy "product_links_select_all" on public.product_links for select using (true);
drop policy if exists "product_links_insert_own" on public.product_links;
create policy "product_links_insert_own" on public.product_links for insert with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 8. 匿名行動ログ(現在は記録OFF。テーブルだけ用意)
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  product_key  text not null,
  product_name text,
  action       text not null,   -- view / click / purchase
  created_at   timestamptz not null default now()
);
create index if not exists activity_log_user_idx    on public.activity_log (user_id, created_at desc);
create index if not exists activity_log_product_idx on public.activity_log (product_key, action);

alter table public.activity_log enable row level security;
drop policy if exists "activity_insert" on public.activity_log;
create policy "activity_insert" on public.activity_log for insert with check (true);


-- ---------------------------------------------------------------------
-- 9. 指値アラート(この価格になったら買いたい)
-- ---------------------------------------------------------------------
create table if not exists public.price_alerts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jan          text not null,
  product_name text,
  image        text,
  target_price integer not null,
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  unique (user_id, jan)
);
create index if not exists price_alerts_jan_idx on public.price_alerts (jan);

alter table public.price_alerts enable row level security;
drop policy if exists "alerts_select_own" on public.price_alerts;
create policy "alerts_select_own" on public.price_alerts for select using (auth.uid() = user_id);
drop policy if exists "alerts_insert_own" on public.price_alerts;
create policy "alerts_insert_own" on public.price_alerts for insert with check (auth.uid() = user_id);
drop policy if exists "alerts_update_own" on public.price_alerts;
create policy "alerts_update_own" on public.price_alerts for update using (auth.uid() = user_id);
drop policy if exists "alerts_delete_own" on public.price_alerts;
create policy "alerts_delete_own" on public.price_alerts for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- 10. まとめ(コレクション)※機能は現在OFF。テーブルだけ用意
-- ---------------------------------------------------------------------
create table if not exists public.collections (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug        text not null unique,
  title       text not null,
  description text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists collections_user_idx on public.collections (user_id, created_at desc);

alter table public.collections enable row level security;
drop policy if exists "collections_select_public" on public.collections;
create policy "collections_select_public" on public.collections for select using (is_public or auth.uid() = user_id);
drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own" on public.collections for insert with check (auth.uid() = user_id);
drop policy if exists "collections_update_own" on public.collections;
create policy "collections_update_own" on public.collections for update using (auth.uid() = user_id);
drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own" on public.collections for delete using (auth.uid() = user_id);

create table if not exists public.collection_items (
  id            bigint generated always as identity primary key,
  collection_id bigint not null references public.collections(id) on delete cascade,
  position      smallint not null default 0,
  product_key   text not null,
  name          text not null,
  image         text,
  price         integer,
  store         text,
  url           text,
  comment       text
);
create index if not exists collection_items_cid_idx on public.collection_items (collection_id, position);

alter table public.collection_items enable row level security;
drop policy if exists "citems_select" on public.collection_items;
create policy "citems_select" on public.collection_items for select using (
  exists (select 1 from public.collections c
          where c.id = collection_id and (c.is_public or c.user_id = auth.uid()))
);
drop policy if exists "citems_write" on public.collection_items;
create policy "citems_write" on public.collection_items for all using (
  exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
);

create table if not exists public.profiles_affiliate (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  rakuten_affiliate_id text,
  vc_sid               text,
  vc_pid               text,
  amazon_tag           text,
  updated_at           timestamptz not null default now()
);

alter table public.profiles_affiliate enable row level security;
drop policy if exists "aff_select_own" on public.profiles_affiliate;
create policy "aff_select_own" on public.profiles_affiliate for select using (auth.uid() = user_id);
drop policy if exists "aff_upsert_own" on public.profiles_affiliate;
create policy "aff_upsert_own" on public.profiles_affiliate for insert with check (auth.uid() = user_id);
drop policy if exists "aff_update_own" on public.profiles_affiliate;
create policy "aff_update_own" on public.profiles_affiliate for update using (auth.uid() = user_id);
drop policy if exists "aff_delete_own" on public.profiles_affiliate;
create policy "aff_delete_own" on public.profiles_affiliate for delete using (auth.uid() = user_id);

create or replace function public.collection_affiliate(_slug text)
returns table (rakuten_affiliate_id text, vc_sid text, vc_pid text, amazon_tag text)
language sql
security definer
set search_path = public
as $$
  select a.rakuten_affiliate_id, a.vc_sid, a.vc_pid, a.amazon_tag
  from public.collections c
  join public.profiles_affiliate a on a.user_id = c.user_id
  where c.slug = _slug and c.is_public
  limit 1;
$$;
grant execute on function public.collection_affiliate(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. テーブルの利用権限(アクセス制御はRLSで行う)
--     新しいプロジェクトでは自動で付かない場合があるため明示しておく
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.price_history, public.reviews, public.sale_events,
                public.product_links, public.collections, public.collection_items
  to anon, authenticated;
grant select, insert, update, delete on public.wishlists, public.purchases, public.reviews,
                public.points, public.price_alerts, public.product_links,
                public.collections, public.collection_items, public.profiles_affiliate
  to authenticated;
grant insert on public.activity_log to anon, authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage on all sequences in schema public to authenticated;


-- ---------------------------------------------------------------------
-- 12. 容量パンク防止: 古い価格履歴の自動削除
--   ・リスト登録/指値ありの商品 … 180日保持
--   ・それ以外                 … 30日保持(買い時バッジは14日、グラフ1か月まで表示可)
--   ・それでも200万行(目安 約300MB)を超えたら、追跡外の古い日から削る(最低14日は残す)
-- ---------------------------------------------------------------------
create or replace function public.prune_price_history()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d1 integer := 0; d2 integer := 0; d3 integer := 0; d4 integer := 0;
  total bigint; oldest date; i integer := 0;
begin
  delete from public.price_history where recorded_at < current_date - 180;
  get diagnostics d1 = row_count;

  delete from public.price_history p
  where p.recorded_at < current_date - 30
    and not exists (select 1 from public.wishlists w where w.jan = p.jan)
    and not exists (select 1 from public.price_alerts a where a.jan = p.jan);
  get diagnostics d2 = row_count;

  delete from public.activity_log where created_at < now() - interval '90 days';
  get diagnostics d3 = row_count;

  -- 行数の上限ガード(1日ずつ、最大20日分まで)
  loop
    select count(*) into total from public.price_history;
    exit when total <= 2000000 or i >= 20;
    select min(recorded_at) into oldest from public.price_history p
      where not exists (select 1 from public.wishlists w where w.jan = p.jan)
        and not exists (select 1 from public.price_alerts a where a.jan = p.jan);
    exit when oldest is null or oldest >= current_date - 14;
    delete from public.price_history p
    where p.recorded_at = oldest
      and not exists (select 1 from public.wishlists w where w.jan = p.jan)
      and not exists (select 1 from public.price_alerts a where a.jan = p.jan);
    get diagnostics d4 = row_count;
    i := i + 1;
  end loop;

  return format('180日超:%s / 30日超(追跡外):%s / 行動ログ:%s / 上限ガード:%s日分', d1, d2, d3, i);
end $$;

revoke execute on function public.prune_price_history() from public, anon, authenticated;
grant  execute on function public.prune_price_history() to service_role;

-- 毎日 4:00 JST(=19:00 UTC)に自動実行
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'oudan-prune';
select cron.schedule('oudan-prune', '0 19 * * *', $$select public.prune_price_history();$$);


-- ---------------------------------------------------------------------
-- 確認用: 下の結果に 12個のテーブル名が出ればOK
-- ---------------------------------------------------------------------
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
