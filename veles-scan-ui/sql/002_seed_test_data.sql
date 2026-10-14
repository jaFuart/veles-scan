INSERT INTO users (id, email, password_hash, full_name, role, balance_rub)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ivan.petrov@velescan.test', 'plain:user123', 'Иван Петров', 'user', 2612),
  ('22222222-2222-2222-2222-222222222222', 'anna.smirnova@velescan.test', 'plain:user123', 'Анна Смирнова', 'user', 970),
  ('99999999-9999-9999-9999-999999999999', 'admin@velescan.test', 'plain:admin123', 'Администратор', 'admin', 0)
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_consents (user_id, consent_text)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Даю согласие с правилами и офертой'),
  ('22222222-2222-2222-2222-222222222222', 'Даю согласие с правилами и офертой')
ON CONFLICT (user_id, consent_text) DO NOTHING;

INSERT INTO projects (
  id,
  user_id,
  title,
  description,
  status,
  project_price_rub,
  updated_text,
  source_query_text,
  result_file,
  error_message,
  started_at,
  finished_at
)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '11111111-1111-1111-1111-111111111111',
    'Застройщики Москвы и МО',
    'Собрать действующих застройщиков, контакты отдела продаж, сайт и адрес офиса.',
    'done',
    1488,
    'Обновлено 2 минуты назад',
    'Найти застройщиков Москвы и Московской области с действующими проектами, собрать контакты.',
    '1124177-result.csv',
    NULL,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '30 minutes'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    '11111111-1111-1111-1111-111111111111',
    'Поставщики металлоконструкций',
    'Собрать производителей и поставщиков металлоконструкций по ЦФО.',
    'working',
    1488,
    'Обновлено 5 минут назад',
    'Собрать базу поставщиков металлоконструкций ЦФО с проверкой активности.',
    NULL,
    NULL,
    NOW() - INTERVAL '20 minutes',
    NULL
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
    '22222222-2222-2222-2222-222222222222',
    'Логистические компании СПб',
    'Найти компании с собственным автопарком и доставкой по РФ.',
    'error',
    1488,
    'Обновлено 1 минуту назад',
    'Собрать логистические компании Санкт-Петербурга и ЛО с контактами и типом перевозок.',
    NULL,
    'Работа программы завершилась с системной ошибкой. Пожалуйста, сообщите в поддержку о данной проблеме.',
    NOW() - INTERVAL '15 minutes',
    NOW() - INTERVAL '1 minute'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_columns (project_id, position, column_name)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1, 'Название компании'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 2, 'ИНН'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 3, 'Телефон отдела продаж'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 4, 'Email'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 5, 'Адрес офиса'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 6, 'Сайт'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 1, 'Название компании'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 2, 'ИНН'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 3, 'Телефон'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 4, 'Email'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 5, 'Регион'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 1, 'Название компании'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 2, 'ИНН'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 3, 'Телефон'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 4, 'Тип перевозок')
ON CONFLICT (project_id, position) DO NOTHING;

INSERT INTO project_status_history (project_id, status, title, text, created_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'new', 'Создание проекта', 'Проект создан в системе', NOW() - INTERVAL '2 hours 10 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'working', 'Запуск алгоритма', 'Алгоритм приступил к сбору данных', NOW() - INTERVAL '2 hours'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'done', 'Готово', 'Результат сформирован и доступен для скачивания', NOW() - INTERVAL '30 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'new', 'Создание проекта', 'Проект создан в системе', NOW() - INTERVAL '25 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'working', 'Выполнение', 'Идёт сбор и валидация данных', NOW() - INTERVAL '20 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'new', 'Создание проекта', 'Проект создан в системе', NOW() - INTERVAL '18 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'working', 'Запуск алгоритма', 'Алгоритм приступил к сбору данных', NOW() - INTERVAL '15 minutes'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'error', 'Ошибка', 'Работа программы завершилась с системной ошибкой.', NOW() - INTERVAL '1 minute')
ON CONFLICT DO NOTHING;

INSERT INTO project_result_rows (project_id, row_number, row_data)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    1,
    '{"Название компании":"ООО Строй-Гарант","ИНН":"7701234567","Телефон отдела продаж":"+7 (495) 000-00-01","Email":"sales@stroy-garant.ru","Адрес офиса":"г. Москва, ул. Примерная, 1","Сайт":"https://stroy-garant.ru"}'::jsonb
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    2,
    '{"Название компании":"АО ДомИнвест","ИНН":"7722334455","Телефон отдела продаж":"+7 (495) 000-00-02","Email":"info@dominvest.ru","Адрес офиса":"г. Химки, ул. Центральная, 5","Сайт":"https://dominvest.ru"}'::jsonb
  )
ON CONFLICT (project_id, row_number) DO NOTHING;

INSERT INTO example_prompts (title, text)
VALUES
  (
    'Застройщики Москвы и Подмосковья',
    'Необходимо собрать актуальную базу застройщиков Москвы и Московской области. Указать только компании с действующими проектами, добавить контакты отдела продаж и официальный сайт.'
  ),
  (
    'Логистические компании Санкт-Петербурга',
    'Собрать транспортно-логистические компании Санкт-Петербурга и Ленинградской области, которые выполняют грузоперевозки по РФ. Добавить телефоны, email, типы перевозок и сайт.'
  )
ON CONFLICT (title) DO NOTHING;

WITH prompt_map AS (
  SELECT id, title FROM example_prompts WHERE title IN ('Застройщики Москвы и Подмосковья', 'Логистические компании Санкт-Петербурга')
)
INSERT INTO example_prompt_columns (prompt_id, position, column_name)
SELECT p.id, c.position, c.column_name
FROM prompt_map p
JOIN (
  VALUES
    ('Застройщики Москвы и Подмосковья', 1::smallint, 'Название компании'),
    ('Застройщики Москвы и Подмосковья', 2::smallint, 'ИНН'),
    ('Застройщики Москвы и Подмосковья', 3::smallint, 'Телефон отдела продаж'),
    ('Застройщики Москвы и Подмосковья', 4::smallint, 'Email'),
    ('Застройщики Москвы и Подмосковья', 5::smallint, 'Адрес офиса'),
    ('Застройщики Москвы и Подмосковья', 6::smallint, 'Сайт'),
    ('Логистические компании Санкт-Петербурга', 1::smallint, 'Название компании'),
    ('Логистические компании Санкт-Петербурга', 2::smallint, 'ИНН'),
    ('Логистические компании Санкт-Петербурга', 3::smallint, 'Телефон'),
    ('Логистические компании Санкт-Петербурга', 4::smallint, 'Email'),
    ('Логистические компании Санкт-Петербурга', 5::smallint, 'Тип перевозок'),
    ('Логистические компании Санкт-Петербурга', 6::smallint, 'Сайт')
) AS c(title, position, column_name)
  ON c.title = p.title
ON CONFLICT (prompt_id, position) DO NOTHING;

INSERT INTO finance_operations (user_id, operation_type, amount_rub, note, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Пополнение', 3000, 'Банковская карта •••• 2048', NOW() - INTERVAL '3 days'),
  ('11111111-1111-1111-1111-111111111111', 'Списание', 1488, 'Проект #1124177', NOW() - INTERVAL '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'Пополнение', 1100, 'СБП', NOW() - INTERVAL '8 hours'),
  ('22222222-2222-2222-2222-222222222222', 'Пополнение', 1500, 'Банковская карта', NOW() - INTERVAL '2 days'),
  ('22222222-2222-2222-2222-222222222222', 'Списание', 530, 'Проект #220010', NOW() - INTERVAL '12 hours')
ON CONFLICT DO NOTHING;

INSERT INTO promo_codes (code, amount_rub, max_activations, expires_at, expires_timezone, created_by_user_id, is_active)
VALUES
  ('WELCOME500', 500, 50, NOW() + INTERVAL '90 days', 'Europe/Moscow', '99999999-9999-9999-9999-999999999999', TRUE),
  ('SPRING1000', 1000, 10, NOW() + INTERVAL '30 days', 'Europe/Moscow', '99999999-9999-9999-9999-999999999999', TRUE),
  ('FOREVER250', 250, 0, NULL, NULL, '99999999-9999-9999-9999-999999999999', TRUE)
ON CONFLICT (code) DO NOTHING;
