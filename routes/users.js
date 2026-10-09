
var express = require('express')

var router = express.Router()
module.exports = router

const users = [
  {
    id: 1,
    name: 'Liran',
    address: 'IL',
    role: 'user'
  },
  {
    id: 2,
    name: 'Simon',
    address: 'UK',
    role: 'admin'
  }
]

router.get('/', async (req, res, next) => {
  return res.json(users)
})

router.post('/', async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  const role = typeof req.body.role === 'string' ? req.body.role.trim() : ''

  if (!name || !address || !['user', 'admin'].includes(role)) {
    return res.status(400).send({ ok: false, error: 'Invalid user payload' })
  }

  users.push({
    id: users.length + 1,
    name: name.slice(0, 80),
    address: address.slice(0, 80),
    role
  })

  return res.sendStatus(201)
})
