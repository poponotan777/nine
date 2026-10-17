-- =====================================================================
-- オウダン v22:トップの「おすすめ・お得・急上昇」を選ぶ関数
--   v18 の後に SQL Editor へ全部貼り付けて Run 1回。何度流しても安全です。
--   ・お得   :90日の中央値より8%以上安い(記録7日以上・2日以内に更新・300円以上)
--   ・急上昇 :ランキングの順位が大きく上がった/新しくランク入り(今日・昨日)
--   ・おすすめ:有名ブランドでランキング入り、かつ★4以上・レビュー30件以上
-- =====================================================================

create index if not exists offers_deal_idx on public.offers (updated_at) where days >= 7 and median90 > 0;

create or replace function public.top_picks(_n integer default 24)
returns table (kind text, pkey text, score numeric, store text)
language sql
stable
security definer
set search_path = public
as $$
  (select 'deal'::text, o.pkey, round(((o.median90 - o.price)::numeric / o.median90) * 100, 1), o.store
     from public.offers o
     join public.products p on p.pkey = o.pkey
    where p.merged_into is null
      and o.days >= 7 and o.median90 > 0 and o.price >= 300
      and o.price <= o.median90 * 0.92
      and o.updated_at > now() - interval '2 days'
    order by (o.median90 - o.price)::numeric / o.median90 desc
    limit greatest(1, least(_n, 60)) * 2)
  union all
  (select 'trend'::text, p.pkey, p.trend::numeric, null::text
     from public.products p
    where p.merged_into is null and p.trend > 0
      and p.trend_day >= (now() at time zone 'Asia/Tokyo')::date - 1
    order by p.trend desc
    limit greatest(1, least(_n, 60)))
  union all
  (select 'recommend'::text, p.pkey, p.pop::numeric, null::text
     from public.products p
    where p.merged_into is null and p.pop is not null and p.is_brand
      and exists (select 1 from public.offers o
                   where o.pkey = p.pkey and coalesce(o.review_avg, 0) >= 4 and coalesce(o.review_count, 0) >= 30)
    order by p.pop asc
    limit greatest(1, least(_n, 60)))
$$;

revoke execute on function public.top_picks(integer) from public;
grant execute on function public.top_picks(integer) to anon, authenticated, service_role;

select count(*) as "候補の数(自動取得前は0でOK)" from public.top_picks(24);
