//
// Copyright 2018 by The Gardener Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict'

const logger = require('../logger')
const { findIndex, set, remove, get } = require('lodash')

const events = [
  'ADDED',
  'MODIFIED',
  'DELETED',
  'ERROR'
]
exports.events = events

const namespacedResources = [
  'shoots'
]
exports.namespacedResources = namespacedResources

function registerHandler (emitter, handler) {
  emitter.on('connect', () => {
    logger.debug('watch %s connected', emitter.resourceName)
  })
  emitter.on('disconnect', err => {
    logger.error('watch %s disconnected', emitter.resourceName, err)
  })
  emitter.on('reconnect', (n, delay) => {
    logger.debug('watch %s reconnect attempt %d after %d', emitter.resourceName, n, delay)
  })
  emitter.on('error', err => {
    logger.error('watch error', err, emitter.resourceName)
  })
  emitter.on('event', (event) => {
    const type = event.type
    if (events.includes(type)) {
      if (type !== 'ERROR') {
        const metadata = event.object.metadata
        const name = metadata.name
        logger.debug('%s to %s: %s', type, emitter.resourceName, name)
        handler(event)
      } else {
        const status = event.object
        logger.error('ERROR: Code "%s", Reason "%s", message "%s, watch: %s"', status.code, status.reason, status.message, emitter.resourceName)
      }
    }
  })
}
exports.registerHandler = registerHandler

function cacheResource (resourceEmitter, cache, keyPath, cacheName, filter = () => false) {
  resourceEmitter.on('connect', () => {
    remove(cache, () => true)
  })
  registerHandler(resourceEmitter, event => {
    let eventType = event.type
    if (filter(event)) {
      eventType = 'DELETED'
      logger.debug(`${cacheName}: filtered object`)
    }
    if (eventType === 'ADDED' || eventType === 'MODIFIED') {
      const key = get(event.object, keyPath)
      const index = findIndex(cache, [keyPath, key])
      if (index !== -1) {
        set(cache, index, event.object)
      } else {
        cache.push(event.object)
      }
    } else if (eventType === 'DELETED') {
      const key = get(event.object, keyPath)
      const predicate = item => get(item, keyPath) === key
      const index = findIndex(cache, predicate)
      if (index !== -1) {
        cache.splice(index, 1)
      }
    }
    logger.debug(cacheName, cache.length)
  })
}
exports.cacheResource = cacheResource
