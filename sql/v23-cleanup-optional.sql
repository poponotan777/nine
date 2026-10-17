-- =====================================================================
-- オウダン v23(任意):使わなくなったアカウント関係のテーブルを削除する
--
--   ⚠ 元に戻せません。入っているデータ(リスト・購入履歴・ポイント・レビュー・指値など)は消えます。
--     新しいプロジェクトで作り直した直後(ユーザーデータが無い)なら、消して問題ありません。
--   ⚠ 流さなくてもサイトは動きます(テーブルが残るだけ)。容量を少しでも空けたいときに。
--
--   消すもの:wishlists / purchases / points / reviews / price_alerts / product_links /
--            activity_log / profiles_affiliate / price_history(v18以前の価格記録)と、その掃除の自動実行
--   残すもの:products / offers / fill_queue / collect_runs / collector_state / sale_events /
--            collections / collection_items
-- =====================================================================

-- 古い価格記録の自動掃除(price_history・wishlists を参照している)を止める
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'oudan-prune';
  end if;
end $$;

drop function if exists public.prune_price_history();
drop function if exists public.record_price_min(jsonb);
drop function if exists public.collection_affiliate(text);

drop table if exists public.wishlists cascade;
drop table if exists public.purchases cascade;
drop table if exists public.points cascade;
drop table if exists public.reviews cascade;
drop table if exists public.price_alerts cascade;
drop table if exists public.product_links cascade;
drop table if exists public.activity_log cascade;
drop table if exists public.profiles_affiliate cascade;
drop table if exists public.price_history cascade;

-- 確認:残っているテーブル
select table_name from information_schema.tables where table_schema = 'public' order by table_name;
