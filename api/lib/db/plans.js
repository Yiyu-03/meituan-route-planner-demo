import { getSql } from './client.js'

export async function savePlan({ id, userId = null, deviceToken = null, request, constraints, routes, dataSources }) {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO plans (id, user_id, device_token, request, constraints, routes, data_sources)
    VALUES (${id}, ${userId}, ${deviceToken}, ${request},
            ${JSON.stringify(constraints)}::jsonb, ${JSON.stringify(routes)}::jsonb, ${JSON.stringify(dataSources)}::jsonb)
    RETURNING id, created_at
  `
  return rows[0]
}
