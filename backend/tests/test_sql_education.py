import unittest
from sql_education import run_query, SqlEducationError


TABLES = [
    {'name': 'students', 'columns': [
        {'name': 'name', 'type': 'VARCHAR'}, {'name': 'department', 'type': 'VARCHAR'},
        {'name': 'score', 'type': 'INTEGER'},
    ], 'rows': [['Alice', 'CS', 85], ['Bob', 'CS', 55], ['Carol', 'CS', 90], ['Eve', 'Math', None]]},
    {'name': 'departments', 'columns': [
        {'name': 'name', 'type': 'VARCHAR'}, {'name': 'building', 'type': 'VARCHAR'},
    ], 'rows': [['CS', 'A'], ['Math', 'B']]},
]


class SqlEducationTests(unittest.TestCase):
    def test_filter_nulls_and_projection_have_real_intermediate_rows(self):
        result = run_query('SELECT name FROM students WHERE score >= 60 ORDER BY name', TABLES)
        self.assertEqual(len(result['steps'][0]['result']['rows']), 4)
        self.assertEqual(len(result['steps'][1]['result']['rows']), 2)
        self.assertEqual(result['finalResult']['rows'], [['Alice'], ['Carol']])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])

    def test_group_having_aliases_and_limit(self):
        result = run_query('SELECT department, COUNT(*) AS total FROM students WHERE score >= 60 GROUP BY department HAVING total >= 2 ORDER BY total DESC LIMIT 1', TABLES)
        self.assertEqual(result['finalResult']['rows'], [['CS', 2]])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])

    def test_join_does_not_lose_duplicates(self):
        result = run_query('SELECT d.building FROM students s JOIN departments d ON s.department = d.name ORDER BY d.building', TABLES)
        self.assertEqual(result['finalResult']['rows'], [['A'], ['A'], ['A'], ['B']])
        self.assertEqual(len(result['steps'][1]['result']['rows']), 4)

    def test_distinct_and_no_order(self):
        result = run_query('SELECT DISTINCT department FROM students', TABLES)
        self.assertFalse(result['ordered'])
        self.assertEqual(sorted(result['finalResult']['rows']), [['CS'], ['Math']])

    def test_unsupported_writes_files_multiple_queries_and_subqueries(self):
        for sql in ["SELECT * FROM read_csv('/etc/passwd')", 'DROP TABLE students',
                    'SELECT 1; SELECT 2', 'SELECT * FROM missing',
                    'SELECT * FROM (SELECT * FROM students)',
                    'SELECT row_number() OVER () FROM students']:
            with self.subTest(sql=sql), self.assertRaises(SqlEducationError):
                run_query(sql, TABLES)

    def test_real_engine_reports_unknown_column_and_each_run_is_isolated(self):
        with self.assertRaises(SqlEducationError):
            run_query('SELECT missing_column FROM students', TABLES)
        self.assertEqual(run_query('SELECT COUNT(*) AS n FROM students', TABLES)['finalResult']['rows'], [[4]])
        with self.assertRaises(SqlEducationError):
            run_query('SELECT * FROM departments', TABLES[:1])


if __name__ == '__main__':
    unittest.main()
