-- =====================================================================
-- オウダン v21:商品まとめ(運営だけが作る・3テンプレート・OGP画像)
--   v18 の後に、SQL Editor へ全部貼り付けて Run 1回。何度流しても安全です。
--
--   変更点:
--   ・まとめは「運営だけ」が作る → 書き込みはサーバー(合言葉つきの管理API)からのみ
--     (一般ユーザー向けの作成・編集・削除のポリシーを外す)
--   ・テンプレート(ranking=TOP N / lineup=横並びN選 / compare=比較リスト)
--   ・各商品に「作成時の3サイト価格」を保存(prices)
--   ・作成者のアフィリエイトIDに差し替える仕組み(profiles_affiliate / collection_affiliate)は使わない
-- =====================================================================

alter table public.collections alter column user_id drop not null;
alter table public.collections alter column user_id drop default;
alter table public.collections add column if not exists template     text not null default 'ranking';
alter table public.collections add column if not exists subtitle     text;
alter table public.collections add column if not exists author_name  text;
alter table public.collections add column if not exists published_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'collections_template_chk') then
    alter table public.collections add constraint collections_template_chk check (template in ('ranking','lineup','compare'));
  end if;
end $$;

alter table public.collection_items add column if not exists headline    text;
alter table public.collection_items add column if not exists prices      jsonb;        -- {"rakuten":1234,"yahoo":1300,"amazon":null}
alter table public.collection_items add column if not exists snapshot_at timestamptz;

-- 公開中のまとめは誰でも読める/書き込みはサーバーのみ
drop policy if exists "collections_select_public" on public.collections;
create policy "collections_select_public" on public.collections for select using (is_public);
drop policy if exists "collections_insert_own" on public.collections;
drop policy if exists "collections_update_own" on public.collections;
drop policy if exists "collections_delete_own" on public.collections;

drop policy if exists "citems_select" on public.collection_items;
create policy "citems_select" on public.collection_items for select using (
  exists (select 1 from public.collections c where c.id = collection_id and c.is_public)
);
drop policy if exists "citems_write" on public.collection_items;

revoke insert, update, delete on public.collections, public.collection_items from anon, authenticated;
grant select on public.collections, public.collection_items to anon, authenticated;
grant all on public.collections, public.collection_items to service_role;

-- 作成者IDへの差し替え用の関数は使わないので、外から呼べないようにする
do $$ begin
  if exists (select 1 from pg_proc where proname = 'collection_affiliate') then
    revoke execute on function public.collection_affiliate(text) from anon, authenticated;
  end if;
end $$;

select column_name from information_schema.columns
where table_schema = 'public' and table_name in ('collections','collection_items')
  and column_name in ('template','subtitle','author_name','published_at','headline','prices','snapshot_at')
order by column_name;
