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
    def test_filter_branches_include_null_and_preserve_duplicates(self):
        result = run_query('SELECT name FROM students WHERE score >= 60', TABLES)
        branches = result['steps'][1]['branches']
        self.assertEqual([row[0] for row in branches[0]['result']['rows']], ['Alice', 'Carol'])
        self.assertEqual([row[0] for row in branches[1]['result']['rows']], ['Bob', 'Eve'])

    def test_having_branches_keep_group_aliases(self):
        result = run_query('SELECT department, COUNT(*) AS total FROM students GROUP BY department HAVING total >= 2', TABLES)
        self.assertEqual(result['steps'][-1]['branches'][0]['result']['rows'], [['CS', 3]])
        self.assertEqual(result['steps'][-1]['branches'][1]['result']['rows'], [['Math', 1]])
        self.assertEqual(len(result['steps'][-2]['inputs'][0]['result']['rows']), 4)

    def test_left_join_inputs_and_unmatched_null(self):
        result = run_query('SELECT s.name, d.building FROM students s LEFT JOIN departments d ON s.department = d.name AND s.score >= 60', TABLES)
        join = result['steps'][1]
        self.assertEqual(len(join['inputs'][0]['result']['rows']), 4)
        self.assertEqual(len(join['inputs'][1]['result']['rows']), 2)
        self.assertIn(['Eve', None], result['finalResult']['rows'])

    def test_boolean_connectors_in_filters_and_having(self):
        result = run_query("SELECT department, COUNT(*) AS total, SUM(score) AS points FROM students WHERE (score >= 60 OR score IS NULL) AND NOT department = 'Math' GROUP BY department HAVING COUNT(*) >= 2 AND SUM(score) >= 100 ORDER BY points DESC LIMIT 2", TABLES)
        self.assertEqual(result['finalResult']['rows'], [['CS', 2, 175]])

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
                    'WITH RECURSIVE t AS (SELECT 1 UNION ALL SELECT 1 FROM t) SELECT * FROM t',
                    "SELECT * FROM read_parquet('/tmp/data')"]:
            with self.subTest(sql=sql), self.assertRaises(SqlEducationError):
                run_query(sql, TABLES)

    def test_case_partitions_are_first_match_and_null_aware(self):
        result = run_query("SELECT name, CASE WHEN score >= 60 THEN 'Pass' WHEN score >= 90 THEN 'A' ELSE 'Other' END AS grade FROM students", TABLES)
        branches = result['steps'][-1]['caseBranches']
        self.assertEqual(len(branches[0]['result']['rows']), 2)
        self.assertEqual(branches[1]['result']['rows'], [])
        self.assertEqual([row[0] for row in branches[2]['result']['rows']], ['Bob', 'Eve'])

    def test_simple_case_and_grouped_case(self):
        result = run_query("SELECT CASE department WHEN 'CS' THEN 'Computing' ELSE 'Other' END FROM students", TABLES)
        self.assertEqual(len(result['steps'][-1]['caseBranches'][0]['result']['rows']), 3)
        grouped = run_query("SELECT department, SUM(CASE WHEN score >= 60 THEN 1 ELSE 0 END) AS passed FROM students GROUP BY department ORDER BY department", TABLES)
        self.assertEqual(grouped['finalResult']['rows'], [['CS', 2], ['Math', 0]])

    def test_cte_derived_and_correlated_subqueries(self):
        queries = [
            'WITH passed AS (SELECT * FROM students WHERE score >= 60) SELECT name FROM passed ORDER BY name',
            'SELECT name FROM (SELECT * FROM students WHERE score >= 60) p ORDER BY name',
            'SELECT name FROM students WHERE score > (SELECT AVG(score) FROM students) ORDER BY name',
            'SELECT name FROM students s WHERE EXISTS (SELECT 1 FROM departments d WHERE d.name = s.department AND d.building = \'A\') ORDER BY name',
        ]
        expected = [[['Alice'], ['Carol']], [['Alice'], ['Carol']], [['Alice'], ['Carol']], [['Alice'], ['Bob'], ['Carol']]]
        for sql, rows in zip(queries, expected):
            with self.subTest(sql=sql):
                result = run_query(sql, TABLES)
                self.assertEqual(result['finalResult']['rows'], rows)
                self.assertEqual(result['steps'][-1]['result'], result['finalResult'])

    def test_set_operations_and_windows(self):
        for operation, rows in [('UNION', [['CS'], ['Math']]), ('INTERSECT', [['CS'], ['Math']]), ('EXCEPT', [])]:
            result = run_query(f'SELECT department FROM students {operation} SELECT name FROM departments ORDER BY 1', TABLES)
            self.assertEqual(result['finalResult']['rows'], rows)
            self.assertTrue(any(step.get('inputMode') == 'set' for step in result['steps']))
        result = run_query('SELECT name, ROW_NUMBER() OVER (PARTITION BY department ORDER BY score DESC NULLS LAST) AS ranking FROM students ORDER BY name LIMIT 2 OFFSET 1', TABLES)
        self.assertEqual(result['finalResult']['rows'], [['Bob', 3], ['Carol', 1]])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])

    def test_group_and_join_links_and_using(self):
        result = run_query('SELECT department, COUNT(*) AS total FROM students GROUP BY department', TABLES)
        grouping = result['steps'][-1]
        cs = grouping['result']['rows'].index(['CS', 3])
        self.assertEqual(grouping['rowLinks'][cs], [[0, 1, 2]])
        result = run_query('SELECT * FROM students s JOIN departments d ON s.department = d.name', TABLES)
        self.assertEqual(result['steps'][1]['rowLinks'][0], [[0], [0]])
        using = run_query('SELECT * FROM students JOIN departments USING (name)', TABLES)
        self.assertEqual(using['finalResult']['rows'], [])

    def test_cte_dependencies_and_set_queries_fork(self):
        result = run_query('WITH a AS (SELECT * FROM students), b AS (SELECT name FROM a) SELECT * FROM b', TABLES)
        steps = result['steps']
        self.assertEqual(steps[2]['dependsOn'], [steps[1]['id']])
        self.assertEqual(steps[4]['dependsOn'], [steps[3]['id']])
        union = run_query('SELECT name FROM students UNION ALL SELECT name FROM students', TABLES)
        self.assertEqual(union['steps'][2]['dependsOn'], [])
        self.assertEqual(union['steps'][-1]['dependsOn'], ['2', '4'])
        self.assertEqual(len(union['finalResult']['rows']), 8)

    def test_null_in_not_in_and_comparison_partitions(self):
        result = run_query('SELECT name FROM students WHERE score NOT IN (SELECT score FROM students WHERE score IS NULL)', TABLES)
        where = result['steps'][1]
        self.assertEqual(where['branches'][0]['result']['rows'], [])
        self.assertEqual(len(where['branches'][1]['result']['rows']), 4)

    def test_case_preserves_window_values_and_nested_case(self):
        result = run_query("SELECT name, ROW_NUMBER() OVER (ORDER BY name) AS n, CASE WHEN department = 'CS' THEN 'C' ELSE 'M' END AS kind FROM students", TABLES)
        branches = result['steps'][-1]['caseBranches']
        self.assertIn(['Eve', 4, 'M'], branches[1]['result']['rows'])
        nested = run_query("SELECT CASE WHEN department = 'CS' THEN CASE WHEN score > 60 THEN 'Pass' ELSE 'Fail' END ELSE 'Other' END FROM students", TABLES)
        self.assertEqual(len(nested['steps'][-1]['caseBranches']), 2)

    def test_group_keys_alias_position_and_empty_group(self):
        for group in ('department', 'dept', '1'):
            result = run_query(f'SELECT department AS dept, COUNT(*) AS n FROM students GROUP BY {group}', TABLES)
            item = result['steps'][-1]
            index = item['result']['rows'].index(['CS', 3])
            self.assertEqual(item['rowLinks'][index], [[0, 1, 2]])
        result = run_query('SELECT COUNT(*) FROM students GROUP BY ()', TABLES)
        self.assertEqual(result['steps'][-1]['rowLinks'], [[[0, 1, 2, 3]]])

    def test_window_having_does_not_rank_excluded_groups(self):
        result = run_query('SELECT department, COUNT(*), RANK() OVER (ORDER BY COUNT(*) DESC) AS rank FROM students GROUP BY department HAVING COUNT(*) >= 2', TABLES)
        self.assertEqual(result['finalResult']['rows'], [['CS', 3, 1]])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])
        self.assertIn('evaluated together', result['steps'][-1]['note'])

    def test_valid_alias_dependency_returns_explicit_trace_boundary(self):
        result = run_query('SELECT score + 1 AS improved FROM students WHERE improved > 80', TABLES)
        self.assertTrue(result['notices'])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])
        self.assertEqual(result['finalResult']['rows'], [[86], [91]])

    def test_dates_strings_and_offset(self):
        result = run_query("SELECT UPPER(name), COALESCE(score, 0), CAST('2026-01-02' AS DATE) FROM students ORDER BY name LIMIT 1 OFFSET 1", TABLES)
        self.assertEqual(result['finalResult']['rows'], [['BOB', 55, '2026-01-02']])
        self.assertEqual(result['steps'][-1]['result'], result['finalResult'])

    def test_real_engine_reports_unknown_column_and_each_run_is_isolated(self):
        with self.assertRaises(SqlEducationError):
            run_query('SELECT missing_column FROM students', TABLES)
        self.assertEqual(run_query('SELECT COUNT(*) AS n FROM students', TABLES)['finalResult']['rows'], [[4]])
        with self.assertRaises(SqlEducationError):
            run_query('SELECT * FROM departments', TABLES[:1])


if __name__ == '__main__':
    unittest.main()
