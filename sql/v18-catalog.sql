-- =====================================================================
-- オウダン v18:商品カタログ(3サイト共通DB)+圧縮した価格記録
--
--   new-project-setup.sql(v17)を流した「後」に、SQL Editor へ全部貼り付けて Run 1回。
--   何度流しても安全です(if not exists / or replace)。
--
--   ■ 価格の持ち方(圧縮)
--     旧:price_history に「1商品×1サイト×1日=1行」(90日で90行)
--     新:offers に「1商品×1サイト=1行」。90日分の日別最安値は hist 配列に詰める
--         → 行数が約90分の1、容量は約6分の1。
--         「中央値」「3か月で何番目に安いか」は書き込み時に計算済みで持つので、
--         表示側は1行読むだけ。
--
--   ■ テーブル
--     products   … 商品(名前・画像・ブランド・人気・急上昇)
--     offers     … サイトごとの価格・ポイント・順位・90日の価格記録
--     fill_queue … 「他のサイトにも同じ商品があるか」を次回探すための予約表
--     collect_runs … 自動取得の実行記録
--     collector_state … 自動取得が覚えておく設定(ジャンル一覧など)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 商品
-- ---------------------------------------------------------------------
create table if not exists public.products (
  pkey        text primary key,         -- JAN(8〜13桁)/ r:楽天商品コード / y:Yahoo!商品コード / a:ASIN
  name        text not null,
  brand       text,
  genre       text,                     -- ジャンル名(表示・絞り込み用)
  image       text,                     -- 表示用の画像URL(楽天・Yahoo!を優先)
  jan         text,
  catch       text,                     -- キャッチコピー(短く)
  tags        text[],                   -- 悩みタグ(lib/pains.js のキー)
  is_brand    boolean not null default false,  -- 有名ブランド表に一致
  pop         integer,                  -- 人気(いちばん良い順位。小さいほど人気)
  trend       integer not null default 0,      -- 急上昇スコア(大きいほど急上昇)
  trend_day   date,
  merged_into text,                     -- 同じ商品と分かって統合された場合の行き先
  first_seen  date not null default ((now() at time zone 'Asia/Tokyo')::date),
  last_seen   date not null default ((now() at time zone 'Asia/Tokyo')::date)
) with (fillfactor = 85);

create index if not exists products_pop_idx   on public.products (pop)          where pop is not null and merged_into is null;
create index if not exists products_trend_idx on public.products (trend desc)   where trend > 0 and merged_into is null;
create index if not exists products_jan_idx   on public.products (jan)          where jan is not null;
create index if not exists products_seen_idx  on public.products (last_seen);


-- ---------------------------------------------------------------------
-- 2. サイトごとの価格(圧縮した90日記録つき)
-- ---------------------------------------------------------------------
create table if not exists public.offers (
  pkey         text not null,
  store        text not null check (store in ('rakuten','yahoo','amazon')),
  code         text,                    -- 楽天itemCode / Yahoo!商品コード / ASIN
  url          text,                    -- 商品ページURL(楽天はAPIが返すアフィリエイトURL)
  shop         text,
  price        integer not null,        -- 最新の価格(税込)
  list_price   integer,                 -- 参考価格(Amazonの参考価格・Yahoo!の通常価格)
  point_rate   real,                    -- ポイント倍率(楽天 pointRate など)
  point_until  timestamptz,             -- ポイント倍率の終了
  sale_until   timestamptz,             -- タイムセール等の終了
  sale_label   text,                    -- 「タイムセール」「セール」など
  review_avg   real,
  review_count integer,
  rank         integer,                 -- 売れ筋順位(ジャンル内。Amazonは売れ筋ランキング)
  rank_genre   text,
  rank_prev    integer,                 -- 前日の順位
  rank_rt      integer,                 -- リアルタイム順位(楽天)
  rank_day     date,
  trend        integer not null default 0,
  updated_at   timestamptz not null default now(),
  -- 90日の記録(圧縮)
  hist_start   date,                    -- hist[1] の日付
  hist         integer[],               -- 日ごとの最安値。記録が無い日は null
  days         smallint,                -- 記録がある日数
  median90     integer,                 -- 90日の中央値
  min90        integer,                 -- 90日の最安値
  rank90       smallint,                -- 今の価格は90日で何番目に安いか(1=最安)
  distinct90   smallint,                -- 90日に出た価格の種類数
  primary key (pkey, store)
) with (fillfactor = 80);

create index if not exists offers_store_upd_idx on public.offers (store, updated_at);
create index if not exists offers_code_idx      on public.offers (store, code);


-- ---------------------------------------------------------------------
-- 3. 他サイト補完の予約表 / 実行記録 / 設定
-- ---------------------------------------------------------------------
create table if not exists public.fill_queue (
  pkey    text not null,
  store   text not null,
  prio    integer not null default 100000,  -- 小さいほど先に処理
  tries   smallint not null default 0,
  next_at timestamptz not null default now(),
  primary key (pkey, store)
);
create index if not exists fill_queue_pick_idx on public.fill_queue (store, prio, next_at);

create table if not exists public.collect_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  slot        text,          -- am / pm
  store       text,
  requests    integer,
  items       integer,
  errors      integer,
  note        text
);

create table if not exists public.collector_state (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. 読み取り権限(価格・商品は誰でも読める/書くのはサーバーだけ)
-- ---------------------------------------------------------------------
alter table public.products        enable row level security;
alter table public.offers          enable row level security;
alter table public.fill_queue      enable row level security;
alter table public.collect_runs    enable row level security;
alter table public.collector_state enable row level security;

drop policy if exists "products_select_all" on public.products;
create policy "products_select_all" on public.products for select using (true);
drop policy if exists "offers_select_all" on public.offers;
create policy "offers_select_all" on public.offers for select using (true);
-- fill_queue / collect_runs / collector_state はポリシー無し=サーバー(シークレットキー)だけ

grant select on public.products, public.offers to anon, authenticated;
grant all on public.products, public.offers, public.fill_queue, public.collect_runs, public.collector_state to service_role;
grant usage on all sequences in schema public to service_role;


-- ---------------------------------------------------------------------
-- 5. 統合先をたどる(商品Aが商品Bに統合済みなら B を返す)
-- ---------------------------------------------------------------------
create or replace function public.resolve_pkey(_k text)
returns text
language plpgsql stable
set search_path = public
as $$
declare k text := _k; m text; i int := 0;
begin
  loop
    select merged_into into m from public.products where pkey = k;
    exit when m is null or m = k or i >= 5;
    k := m; i := i + 1;
  end loop;
  return k;
end $$;


-- ---------------------------------------------------------------------
-- 6. 商品の統合(同じ商品だと分かったとき _from を _to にまとめる)
-- ---------------------------------------------------------------------
create or replace function public.merge_product(_from text, _to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f text := public.resolve_pkey(_from); t text := public.resolve_pkey(_to);
begin
  if f is null or t is null or f = t then return; end if;
  if not exists (select 1 from public.products where pkey = t) then return; end if;

  -- _from の各サイトの価格を _to に移す(_to に同じサイトがあれば、記録日数が多い方を残す)
  insert into public.offers as o
    select t, store, code, url, shop, price, list_price, point_rate, point_until, sale_until, sale_label,
           review_avg, review_count, rank, rank_genre, rank_prev, rank_rt, rank_day, trend, updated_at,
           hist_start, hist, days, median90, min90, rank90, distinct90
    from public.offers where pkey = f
  on conflict (pkey, store) do update set
    code = excluded.code, url = excluded.url, shop = excluded.shop, price = excluded.price,
    list_price = excluded.list_price, point_rate = excluded.point_rate, point_until = excluded.point_until,
    sale_until = excluded.sale_until, sale_label = excluded.sale_label,
    review_avg = excluded.review_avg, review_count = excluded.review_count,
    rank = excluded.rank, rank_genre = excluded.rank_genre, rank_prev = excluded.rank_prev,
    rank_rt = excluded.rank_rt, rank_day = excluded.rank_day, trend = excluded.trend,
    updated_at = excluded.updated_at, hist_start = excluded.hist_start, hist = excluded.hist,
    days = excluded.days, median90 = excluded.median90, min90 = excluded.min90,
    rank90 = excluded.rank90, distinct90 = excluded.distinct90
  where coalesce(excluded.days, 0) >= coalesce(o.days, 0) or excluded.updated_at > o.updated_at + interval '2 days';

  delete from public.offers where pkey = f;
  delete from public.fill_queue where pkey = f;

  -- _to 側の商品情報を補う
  update public.products p set
    jan      = coalesce(p.jan, s.jan),
    brand    = coalesce(p.brand, s.brand),
    genre    = coalesce(p.genre, s.genre),
    image    = coalesce(p.image, s.image),
    catch    = coalesce(p.catch, s.catch),
    tags     = coalesce(p.tags, s.tags),
    is_brand = p.is_brand or s.is_brand,
    pop      = (select min(rank) from public.offers where pkey = t and rank is not null),
    trend    = greatest(p.trend, s.trend),
    first_seen = least(p.first_seen, s.first_seen),
    last_seen  = greatest(p.last_seen, s.last_seen)
  from public.products s
  where p.pkey = t and s.pkey = f;

  update public.products set merged_into = t, pop = null, trend = 0 where pkey = f;

  -- まとめ機能(v21)が先に作られていれば、その中の商品キーも付け替える
  if to_regclass('public.collection_items') is not null then
    execute 'update public.collection_items set product_key = $1 where product_key = $2' using t, f;
  end if;
end $$;

revoke execute on function public.merge_product(text, text) from public, anon, authenticated;
grant  execute on function public.merge_product(text, text) to service_role;


-- ---------------------------------------------------------------------
-- 7. 価格の書き込み(自動取得から500件ずつ呼ばれる)
--    ・同じ日に何度来ても「その日の最安値」を記録
--    ・90日より古い日は自動で押し出す(配列をずらす)
--    ・中央値・最安値・何番目に安いかをここで計算して保存
--    ・_no_new = true のときは新しい商品を増やさない(容量が危ないとき用)
-- ---------------------------------------------------------------------
create or replace function public.record_offers(_rows jsonb, _day date default null, _no_new boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d        date := coalesce(_day, (now() at time zone 'Asia/Tokyo')::date);
  r        jsonb;
  k        text;
  st       text;
  p        integer;
  o        public.offers%rowtype;
  found_o  boolean;
  h        integer[];
  hs       date;
  idx      integer;
  sh       integer;
  len      integer;
  v_rank   integer;
  v_prev   integer;
  v_rt     integer;
  v_rday   date;
  v_trend  integer;
  v_hint   integer;
  c_days   integer;
  c_med    numeric;
  c_min    integer;
  c_rank   integer;
  c_dist   integer;
  v_tags   text[];
  a        text;
  n        integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) loop
    st := r->>'store';
    begin
      p := round((r->>'price')::numeric)::integer;
    exception when others then
      p := null;
    end;
    if st is null or st not in ('rakuten','yahoo','amazon') or p is null or p < 1 or p > 10000000 then
      continue;
    end if;
    k := r->>'pkey';
    if k is null or length(k) < 3 or length(k) > 140 then continue; end if;
    k := public.resolve_pkey(k);

    if _no_new and not exists (select 1 from public.products where pkey = k) then
      continue;
    end if;

    -- 商品(既存の値は空で上書きしない)
    v_tags := case when jsonb_typeof(r->'tags') = 'array'
                   then array(select jsonb_array_elements_text(r->'tags'))
                   else null end;
    if v_tags is not null and cardinality(v_tags) = 0 then v_tags := null; end if;

    insert into public.products as pr (pkey, name, brand, genre, image, jan, catch, tags, is_brand, first_seen, last_seen)
    values (
      k,
      left(coalesce(nullif(r->>'name', ''), k), 200),
      nullif(left(r->>'brand', 60), ''),
      nullif(left(r->>'genre', 60), ''),
      nullif(left(r->>'image', 400), ''),
      case when (r->>'jan') ~ '^\d{8,13}$' then r->>'jan' else null end,
      nullif(left(r->>'catch', 120), ''),
      v_tags,
      coalesce((r->>'is_brand')::boolean, false),
      d, d
    )
    on conflict (pkey) do update set
      -- 名前は最初に付いたものを使い続ける(サイトごとに名前が入れ替わってチラつかないように)
      name     = case when pr.name = pr.pkey and excluded.name <> excluded.pkey then excluded.name else pr.name end,
      brand    = coalesce(pr.brand, excluded.brand),
      genre    = coalesce(excluded.genre, pr.genre),
      -- 画像は楽天・Yahoo!を優先(Amazonの画像は外部で加工・保存できないため)
      image    = case when pr.image is null then excluded.image
                      when pr.image like '%media-amazon%' and excluded.image is not null and excluded.image not like '%media-amazon%' then excluded.image
                      else pr.image end,
      jan      = coalesce(pr.jan, excluded.jan),
      catch    = coalesce(excluded.catch, pr.catch),
      tags     = coalesce(excluded.tags, pr.tags),
      is_brand = pr.is_brand or excluded.is_brand,
      last_seen = greatest(pr.last_seen, excluded.last_seen);

    -- 既存の価格行
    select * into o from public.offers where pkey = k and store = st for update;
    found_o := found;

    -- 90日記録の更新
    if not found_o or o.hist_start is null or o.hist is null or cardinality(o.hist) = 0 then
      h := array[p]; hs := d;
    else
      h := o.hist; hs := o.hist_start;
      idx := d - hs + 1;
      if idx >= 1 then
        if idx > 92 then
          sh := idx - 92;
          len := coalesce(array_length(h, 1), 0);
          if sh >= len then
            h := array[p]; hs := d; idx := 0;  -- 全部古いので作り直し
          else
            h := h[sh + 1 : len];
            hs := hs + sh;
            idx := 92;
          end if;
        end if;
        if idx >= 1 then
          len := coalesce(array_length(h, 1), 0);
          if idx > len then
            -- 間の日は null で埋めてから今日の値を置く
            h := h || array_fill(null::integer, array[idx - len]);
          end if;
          h[idx] := least(h[idx], p);
        end if;
      end if;
      -- idx < 1(過去日付の送信)は記録を変えない
    end if;

    select count(v), percentile_cont(0.5) within group (order by v), min(v), count(distinct v)
      into c_days, c_med, c_min, c_dist
      from unnest(h) as v where v is not null;
    select count(distinct v) + 1 into c_rank from unnest(h) as v where v is not null and v < p;

    -- 順位(ランキング由来の行だけ順位を更新。それ以外は前の値を残す)
    v_rank := case when r ? 'rank' then nullif(r->>'rank', '')::integer else null end;
    v_rt   := case when r ? 'rank_rt' then nullif(r->>'rank_rt', '')::integer else null end;
    if r ? 'rank' then
      if found_o then
        v_prev := case when o.rank_day is distinct from d then o.rank else o.rank_prev end;
        if o.rank_day = d and o.rank is not null and (v_rank is null or o.rank < v_rank) then
          v_rank := o.rank;   -- 同じ日に複数ジャンルで出たら良い方
        end if;
        if not (r ? 'rank_rt') and o.rank_day = d then v_rt := o.rank_rt; end if;
      else
        v_prev := null;
      end if;
      v_rday := d;
    elsif found_o then
      v_rank := o.rank; v_prev := o.rank_prev; v_rday := o.rank_day;
      v_rt := case when r ? 'rank_rt' then v_rt when o.rank_day = d then o.rank_rt else null end;
    else
      v_rank := null; v_prev := null; v_rday := null;
    end if;
    if r ? 'rank_rt' and v_rday is null then v_rday := d; end if;

    -- 急上昇スコア
    v_trend := 0;
    if v_rank is not null then
      if v_prev is null then
        -- 前日まで圏外だった商品が新しくランク入り(同じ日の2回目の取得は数えない)
        if found_o and o.rank_day is distinct from d and o.hist_start is not null and o.hist_start < d then
          v_trend := greatest(0, 300 - v_rank);
        end if;
      elsif v_prev > v_rank then
        v_trend := round((v_prev - v_rank)::numeric * 1000 / v_prev);   -- 順位が上がった割合
      end if;
    end if;
    if v_rt is not null then
      v_trend := greatest(v_trend, round(greatest(0, coalesce(v_rank, 1000) - v_rt)::numeric * 1000 / coalesce(v_rank, 1000)));
    end if;
    v_hint := nullif(r->>'trend_hint', '')::integer;
    if v_hint is not null then v_trend := greatest(v_trend, v_hint); end if;
    if found_o and o.rank_day = d then v_trend := greatest(v_trend, o.trend); end if;

    insert into public.offers as x (
      pkey, store, code, url, shop, price, list_price, point_rate, point_until, sale_until, sale_label,
      review_avg, review_count, rank, rank_genre, rank_prev, rank_rt, rank_day, trend, updated_at,
      hist_start, hist, days, median90, min90, rank90, distinct90
    ) values (
      k, st,
      nullif(left(r->>'code', 120), ''),
      nullif(left(r->>'url', 600), ''),
      nullif(left(r->>'shop', 80), ''),
      p,
      nullif(r->>'list_price', '')::numeric::integer,
      nullif(r->>'point_rate', '')::real,
      nullif(r->>'point_until', '')::timestamptz,
      nullif(r->>'sale_until', '')::timestamptz,
      nullif(left(r->>'sale_label', 30), ''),
      nullif(r->>'review_avg', '')::real,
      nullif(r->>'review_count', '')::integer,
      v_rank,
      case when r ? 'rank_genre' then nullif(left(r->>'rank_genre', 60), '') else o.rank_genre end,
      v_prev, v_rt, v_rday, v_trend, now(),
      hs, h, c_days, round(c_med)::integer, c_min, c_rank, c_dist
    )
    on conflict (pkey, store) do update set
      code = coalesce(excluded.code, x.code),
      url  = coalesce(excluded.url, x.url),
      shop = coalesce(excluded.shop, x.shop),
      price = excluded.price,
      list_price = excluded.list_price,
      point_rate = excluded.point_rate,
      point_until = excluded.point_until,
      sale_until = excluded.sale_until,
      sale_label = excluded.sale_label,
      review_avg = coalesce(excluded.review_avg, x.review_avg),
      review_count = coalesce(excluded.review_count, x.review_count),
      rank = excluded.rank, rank_genre = coalesce(excluded.rank_genre, x.rank_genre),
      rank_prev = excluded.rank_prev, rank_rt = excluded.rank_rt, rank_day = excluded.rank_day,
      trend = excluded.trend, updated_at = excluded.updated_at,
      hist_start = excluded.hist_start, hist = excluded.hist, days = excluded.days,
      median90 = excluded.median90, min90 = excluded.min90, rank90 = excluded.rank90,
      distinct90 = excluded.distinct90;

    -- 人気・急上昇を商品にも反映
    update public.products set
      pop = (select min(rank) from public.offers where pkey = k and rank is not null),
      trend = greatest(case when trend_day = d then trend else 0 end, v_trend),
      trend_day = d
    where pkey = k;

    -- (1) merge_from:補完で「同じ商品」と分かった元の商品を、この商品にまとめる
    if jsonb_typeof(r->'merge_from') = 'array' then
      for a in select jsonb_array_elements_text(r->'merge_from') loop
        if a is not null and length(a) between 3 and 140 and public.resolve_pkey(a) <> k then
          perform public.merge_product(a, k);
        end if;
      end loop;
    end if;

    -- (2) aliases:そのサイトでの商品コード(r:/y:/a:)。次回からこの商品として扱うための転送用。
    --     ただし、すでに別の商品として他サイトの価格を持っているものは、まとめない
    --     (違う2商品が同じ候補に当たって、つながってしまう事故を防ぐ)
    if jsonb_typeof(r->'aliases') = 'array' then
      for a in select jsonb_array_elements_text(r->'aliases') loop
        if a is not null and a <> k and length(a) between 3 and 140 then
          if not exists (select 1 from public.products where pkey = a) then
            insert into public.products (pkey, name, merged_into, first_seen, last_seen)
            values (a, left(coalesce(nullif(r->>'name', ''), a), 200), k, d, d)
            on conflict (pkey) do nothing;
          elsif public.resolve_pkey(a) = a
            and not exists (select 1 from public.offers x2 where x2.pkey = a and x2.store <> st) then
            -- 同じサイトの同じ商品が別キーで登録されていただけ → まとめてよい
            perform public.merge_product(a, k);
          end if;
        end if;
      end loop;
    end if;

    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.record_offers(jsonb, date, boolean) from public, anon, authenticated;
grant  execute on function public.record_offers(jsonb, date, boolean) to service_role;


-- ---------------------------------------------------------------------
-- 8. ランキングの締め(その日のランキングに出なかった商品の順位を外す)
-- ---------------------------------------------------------------------
create or replace function public.finish_ranking(_store text, _day date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare d date := coalesce(_day, (now() at time zone 'Asia/Tokyo')::date); n integer;
begin
  update public.offers
     set rank_prev = rank, rank = null, rank_rt = null, trend = 0
   where store = _store and rank is not null and rank_day < d;
  get diagnostics n = row_count;
  update public.products p set pop = null
   where p.pop is not null
     and not exists (select 1 from public.offers o where o.pkey = p.pkey and o.rank is not null);
  update public.products p set pop = s.m
    from (select pkey, min(rank) m from public.offers where rank is not null group by pkey) s
   where p.pkey = s.pkey and p.pop is distinct from s.m;
  return n;
end $$;

revoke execute on function public.finish_ranking(text, date) from public, anon, authenticated;
grant  execute on function public.finish_ranking(text, date) to service_role;


-- ---------------------------------------------------------------------
-- 9. 他サイト補完の予約
--    ・あるサイトにしか無い商品 → 他の2サイトを次回探す
--    ・3日以上更新されていない人気/ブランド商品 → 取り直す
-- ---------------------------------------------------------------------
create or replace function public.enqueue_missing(_limit integer default 20000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n1 integer; n2 integer;
begin
  -- 統合済み・削除済みの商品は予約から外す
  delete from public.fill_queue q
   where not exists (select 1 from public.products p where p.pkey = q.pkey and p.merged_into is null);

  insert into public.fill_queue (pkey, store, prio)
  select p.pkey, s.store, coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end
    from public.products p
    cross join (values ('rakuten'), ('yahoo'), ('amazon')) as s(store)
   where p.merged_into is null
     and p.last_seen >= (now() at time zone 'Asia/Tokyo')::date - 7
     and not exists (select 1 from public.offers o where o.pkey = p.pkey and o.store = s.store)
   order by coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end
   limit _limit
  on conflict (pkey, store) do nothing;
  get diagnostics n1 = row_count;

  insert into public.fill_queue (pkey, store, prio)
  select o.pkey, o.store, coalesce(p.pop, 50000) + case when p.is_brand then 0 else 20000 end + 5000
    from public.offers o
    join public.products p on p.pkey = o.pkey
   where p.merged_into is null
     and o.updated_at < now() - interval '3 days'
     and (p.pop is not null or p.is_brand)
   order by 3
   limit _limit
  on conflict (pkey, store) do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

revoke execute on function public.enqueue_missing(integer) from public, anon, authenticated;
grant  execute on function public.enqueue_missing(integer) to service_role;


-- 予約から次に探す商品を取り出す(取り出した分は12時間は他から取られない)
create or replace function public.take_fill(_store text, _n integer)
returns table (pkey text, name text, jan text, code text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with c as (
    select q.pkey from public.fill_queue q
     where q.store = _store and q.next_at <= now()
       and not exists (select 1 from public.offers o
                        where o.pkey = q.pkey and o.store = _store and o.updated_at > now() - interval '30 hours')
     order by q.prio, q.next_at
     limit _n
     for update skip locked
  ), u as (
    update public.fill_queue q set next_at = now() + interval '12 hours'
      from c where q.pkey = c.pkey and q.store = _store
    returning q.pkey
  )
  select p.pkey, p.name, p.jan,
         (select o.code from public.offers o where o.pkey = p.pkey and o.store = _store)
    from u join public.products p on p.pkey = u.pkey;
end $$;

revoke execute on function public.take_fill(text, integer) from public, anon, authenticated;
grant  execute on function public.take_fill(text, integer) to service_role;


-- 探した結果を返す [{pkey, store, found}]
create or replace function public.fill_done(_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) loop
    if (r->>'found')::boolean then
      update public.fill_queue set tries = 0, next_at = now() + interval '2 days'
       where pkey = r->>'pkey' and store = r->>'store';
    else
      update public.fill_queue
         set tries = tries + 1,
             next_at = now() + case when tries + 1 >= 4 then interval '90 days'
                                    else make_interval(days => 7 * (tries + 1)) end
       where pkey = r->>'pkey' and store = r->>'store';
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.fill_done(jsonb) from public, anon, authenticated;
grant  execute on function public.fill_done(jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 10. 容量の確認(自動取得が毎回呼び、400MBを超えたらお知らせ)
-- ---------------------------------------------------------------------
create or replace function public.db_usage()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'products', (select count(*) from public.products where merged_into is null),
    'offers',   (select count(*) from public.offers),
    'queue',    (select count(*) from public.fill_queue where next_at <= now()),
    'tables', (
      select jsonb_object_agg(c.relname, pg_total_relation_size(c.oid))
        from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r'
    )
  );
$$;

revoke execute on function public.db_usage() from public, anon, authenticated;
grant  execute on function public.db_usage() to service_role;


-- ---------------------------------------------------------------------
-- 11. 自動掃除(毎日 4:30 JST)
--     ・45日間どのサイトでも見かけなかった商品を削除(まとめに使っている商品は残す)
--     ・実行記録は90日で削除
-- ---------------------------------------------------------------------
create or replace function public.prune_catalog()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare d1 integer; d2 integer; d3 integer; lim date := (now() at time zone 'Asia/Tokyo')::date - 45;
begin
  drop table if exists _gone;
  create temp table _gone on commit drop as
    select p.pkey from public.products p
     where p.merged_into is null and p.last_seen < lim
       and (to_regclass('public.collection_items') is null
            or not exists (select 1 from public.collection_items ci where ci.product_key = p.pkey));
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
  return format('商品削除:%s / 価格行削除:%s / 実行記録削除:%s', d2, d1, d3);
end $$;

revoke execute on function public.prune_catalog() from public, anon, authenticated;
grant  execute on function public.prune_catalog() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'oudan-prune-catalog';
select cron.schedule('oudan-prune-catalog', '30 19 * * *', $$select public.prune_catalog();$$);


-- ---------------------------------------------------------------------
-- 確認用:products / offers / fill_queue / collect_runs / collector_state が出ればOK
-- ---------------------------------------------------------------------
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('products','offers','fill_queue','collect_runs','collector_state')
order by table_name;
