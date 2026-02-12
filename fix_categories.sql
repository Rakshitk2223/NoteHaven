-- Run this SQL in Supabase SQL Editor to create your categories

INSERT INTO ledger_categories (user_id, name, type, color) VALUES
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Salary', 'income', '#10B981'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Freelance', 'income', '#3B82F6'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Investments', 'income', '#8B5CF6'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Other Income', 'income', '#6B7280'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Food & Dining', 'expense', '#EF4444'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Transportation', 'expense', '#F59E0B'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Entertainment', 'expense', '#EC4899'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Shopping', 'expense', '#8B5CF6'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Bills & Utilities', 'expense', '#6366F1'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Healthcare', 'expense', '#14B8A6'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Education', 'expense', '#10B981'),
  ('297ba63a-de8a-4de7-ae56-dbf837e0041d', 'Other Expense', 'expense', '#6B7280');
