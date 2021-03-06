//
// SPDX-FileCopyrightText: 2020 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

'use strict'

const _ = require('lodash')
const { createReconnectorStub } = require('../support/common')
const services = require('../../lib/services')
const { WatchBuilder } = require('@gardener-dashboard/kube-client')
const { cache } = require('../../lib/cache')

module.exports = function ({ agent, sandbox, k8s, auth }) {
  /* eslint no-unused-expressions: 0 */
  const name = 'foo'
  const namespace = `garden-${name}`
  const annotations = {
    'billing.gardener.cloud/costObject': '9999999999'
  }
  const metadata = { name }
  const username = `${name}@example.org`
  const id = username
  const user = auth.createUser({ id, groups: ['group1'] })
  const admin = auth.createUser({ id: 'admin@example.org' })
  const role = 'project'
  const owner = 'owner'
  const description = 'description'
  const purpose = 'purpose'
  const data = { owner, description, purpose }

  beforeEach(function () {
    cache.projects.replace(k8s.projectList)
  })

  it('should return three projects', async function () {
    const bearer = await user.bearer
    k8s.stub.getProjects({ bearer })
    const res = await agent
      .get('/api/namespaces')
      .set('cookie', await user.cookie)

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body).to.have.length(3)
  })

  it('should return all projects', async function () {
    const bearer = await admin.bearer
    k8s.stub.getProjects({ bearer })
    const res = await agent
      .get('/api/namespaces')
      .set('cookie', await admin.cookie)

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body).to.have.length(6)
  })

  it('should return the foo project', async function () {
    const bearer = await user.bearer
    const resourceVersion = 42
    k8s.stub.getProject({ bearer, name, namespace })
    const res = await agent
      .get(`/api/namespaces/${namespace}`)
      .set('cookie', await user.cookie)

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body.metadata).to.eql({ name, namespace, annotations, resourceVersion, role })
  })

  it('should reject request with authorization error', async function () {
    const user = auth.createUser({ id: 'baz@example.org' })
    const bearer = await user.bearer
    k8s.stub.getProject({ bearer, name, namespace, unauthorized: true })
    const res = await agent
      .get(`/api/namespaces/${namespace}`)
      .set('cookie', await user.cookie)

    expect(res).to.have.status(403)
    expect(res).to.be.json
    expect(res.body.code).to.equal(403)
    expect(res.body.reason).to.equal('Forbidden')
  })

  it('should create a project', async function () {
    const bearer = await user.bearer
    const createdBy = username
    const resourceVersion = 42
    const timeout = 30
    k8s.stub.createProject({ bearer, resourceVersion })

    // watch project stub
    const project = k8s.getProject({
      name,
      createdBy,
      owner,
      description,
      purpose,
      phase: 'Initial',
      costObject: '9999999999'
    })
    // project with initializer
    const newProject = _.cloneDeep(project)
    // project without initializer
    const modifiedProject = _.cloneDeep(project)
    modifiedProject.metadata.resourceVersion = resourceVersion
    modifiedProject.status.phase = 'Ready'

    // create watch stub
    const watchStub = sandbox.stub(WatchBuilder, 'create')

    // reconnector
    const reconnectorStub = createReconnectorStub([
      ['ADDED', newProject],
      ['MODIFIED', modifiedProject]
    ])
    sandbox.stub(services.projects, 'projectInitializationTimeout').value(timeout)
    watchStub.callsFake(() => reconnectorStub.start())

    const res = await agent
      .post('/api/namespaces')
      .set('cookie', await user.cookie)
      .send({ metadata, data })

    expect(watchStub).to.have.been.calledOnce
    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body.metadata).to.eql({ name, namespace, annotations, resourceVersion, role })
    expect(res.body.data).to.eql({ createdBy, owner, description, purpose })
  })

  it('should timeout when creating a project', async function () {
    const bearer = await user.bearer
    const createdBy = username
    const resourceVersion = 42
    const timeout = 30
    k8s.stub.createProject({ bearer, resourceVersion })

    // watch project stub
    const project = k8s.getProject({
      name,
      createdBy,
      owner,
      description,
      purpose,
      phase: 'Initial'
    })
    // new project
    const newProject = _.cloneDeep(project)
    // pending project
    const modifiedProject = _.cloneDeep(project)
    modifiedProject.metadata.resourceVersion = resourceVersion
    modifiedProject.status.phase = 'Pending'

    // create watch stub
    const watchStub = sandbox.stub(WatchBuilder, 'create')

    // reconnector
    const reconnectorStub = createReconnectorStub([
      ['ADDED', newProject],
      ['MODIFIED', modifiedProject]
    ], name)
    sandbox.stub(services.projects, 'projectInitializationTimeout').value(timeout)
    watchStub.callsFake(() => reconnectorStub.start())

    const res = await agent
      .post('/api/namespaces')
      .set('cookie', await user.cookie)
      .send({ metadata, data })

    expect(watchStub).to.have.been.calledOnce
    expect(res).to.have.status(504)
    expect(res).to.be.json
    expect(res.body.message).to.equal(`Resource "${name}" could not be initialized within ${timeout} ms`)
  })

  it('should update a project', async function () {
    const bearer = await user.bearer
    const resourceVersion = 43
    const createdBy = k8s.readProject(namespace).spec.createdBy.name
    k8s.stub.patchProject({ bearer, namespace, resourceVersion })

    const res = await agent
      .put(`/api/namespaces/${namespace}`)
      .set('cookie', await user.cookie)
      .send({ metadata, data })

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body.metadata).to.eql({ name, namespace, annotations, resourceVersion, role })
    expect(res.body.data).to.eql({ createdBy, owner, description, purpose })
  })

  it('should patch a project', async function () {
    const bearer = await user.bearer
    const description = 'foobar'

    k8s.stub.patchProject({ bearer, namespace })

    const res = await agent
      .patch(`/api/namespaces/${namespace}`)
      .set('cookie', await user.cookie)
      .send({ data: { description } })

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body.data.description).to.equal(description)
  })

  it('should delete a project', async function () {
    const bearer = await user.bearer
    k8s.stub.deleteProject({ bearer, namespace })

    const res = await agent
      .delete(`/api/namespaces/${namespace}`)
      .set('cookie', await user.cookie)

    expect(res).to.have.status(200)
    expect(res).to.be.json
    expect(res.body.metadata.name).to.equal(name)
    expect(res.body.metadata.namespace).to.equal(namespace)
  })
}
