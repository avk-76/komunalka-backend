create schema if not exists komunalka;

create table if not exists komunalka.period_data (
  apartment_id integer not null,
  period char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  item text not null,
  prev_value numeric(20,3),
  curr_value numeric(20,3),
  tariff     numeric(20,4),
  amount     numeric(20,2),
  meta jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_pd_unique
  on komunalka.period_data(apartment_id, period, item);
