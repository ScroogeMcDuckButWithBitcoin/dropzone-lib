/* global describe it */
/* eslint no-new: 0 */

var chai = require('chai')
var factories = require('../test/factories/factories')
var _ = require('lodash')
var util = require('util')
var async = require('async')

var fakeConnection = require('../lib/drivers/fake')
var invoice = require('../lib/invoice')
var globals = require('./fixtures/globals')

var expect = chai.expect
var Invoice = invoice.Invoice

factories.dz(chai)

describe('Invoice', function () {
  var connection = null

  before(function(next) {
    connection = new fakeConnection.FakeBitcoinConnection(function(err) {
      if (err) throw err
      next()
    })
  })

  after(function(next) {
    connection.clearTransactions(function(err) {
      if (err) throw err
      next()
    })
  })

  it('has accessors', function () {
    var invoice = chai.factory.create('invoice', connection)

    expect(invoice.expirationIn).to.equal(6)
    expect(invoice.amountDue).to.equal(100000000)
    expect(invoice.receiverAddr).to.equal(globals.testerPublicKey)
  })

  it('serializes toTransaction', function () {
    expect(chai.factory.create('invoice', connection).toTransaction()).to.eql(
      { tip: 40000, receiverAddr: globals.testerPublicKey, 
        data: new Buffer([73, 78, 67, 82, 84, 69, 1, 112, 254, 0, 225, 245, 5, 
          1, 101, 6 ]) }) 
  })

  describe("#save() and #find()", function() {
    it('persists and loads', function (next) {
      chai.factory.create('invoice', connection).save(globals.testerPrivateKey, 
        function(err, create_invoice) {

        expect(create_invoice.expirationIn).to.equal(6)
        expect(create_invoice.amountDue).to.equal(100000000)
        expect(create_invoice.receiverAddr).to.equal(globals.testerPublicKey)
        expect(create_invoice.senderAddr).to.equal(globals.testerPublicKey)

        Invoice.find(connection, create_invoice.txid, function(err, find_invoice) {
          expect(find_invoice.expirationIn).to.equal(6)
          expect(find_invoice.amountDue).to.equal(100000000)
          expect(find_invoice.receiverAddr).to.equal(globals.testerPublicKey)
          expect(find_invoice.senderAddr).to.equal(globals.testerPublicKey)

          next()
        })

      })
    })
  })

  describe("associations", function() {
    it("has_many payments", function(nextSpec) {
      async.waterfall([
          function(next){
            // Create an Invoice
            chai.factory.create('invoice', connection, 
              {receiverAddr: globals.tester2PublicKey} )
              .save(globals.testerPrivateKey, next)
          },
          function(invoice, next){
            // Create Payment one:
            var paymentAttrs = { invoiceTxid: invoice.txid, 
              receiverAddr: globals.testerPublicKey, description: 'xyz' }

            chai.factory.create('payment', connection, paymentAttrs)
              .save(globals.tester2PrivateKey, function(err, payment) {
                next(null, invoice)
              })
          },
          function(invoice, next){
            // Increment Block Height
            connection.incrementBlockHeight()
            next(null, invoice)
          },
          function(invoice, next){
            // Create Payment two:
            var paymentAttrs = { invoiceTxid: invoice.txid, 
              receiverAddr: globals.testerPublicKey, description: 'abc' }

            chai.factory.create('payment', connection, paymentAttrs)
              .save(globals.tester2PrivateKey, function(err, payment) {
                next(null, invoice)
              })
          },
          function(invoice, next) {
            // Load the Payments:
            invoice.getPayments(next)
          }
        ], function (err, payments) {
            var descriptons = _.map(payments, 
              function(p) { return p.description } )

            expect(payments.length).to.equal(2)
            expect(payments.descriptions).to.equal(['xyz','abc'])
            nextSpec()
        })
      })
    })
  describe("validations", function() {
    it("validates default build", function(next) {
      var invoice = chai.factory.create('invoice', connection)

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(0)
        expect(errors).to.be.empty
        next()
      })
    })

    it("validates minimal invoice", function(next) {
      var invoice = new Invoice( connection, 
        {receiverAddr: globals.testerPublicKey})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(0)
        expect(errors).to.be.empty
        next()
      })
    })

    it("expirationIn must be numeric", function(next) {
      var invoice = chai.factory.create('invoice', connection, 
        {expirationIn: 'abc'})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(1)
        expect(errors).to.deep.equal([ 
          {parameter: 'expirationIn', value: 'abc', 
            message: 'Incorrect type. Expected number.'},
          ])

        next()
      })
    })

    it("expirationIn must gt 0", function(next) {
      var invoice = chai.factory.create('invoice', connection, 
        {expirationIn: -1})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(1)
        expect(errors).to.deep.equal([ 
          {parameter: 'expirationIn', value: -1, 
            message: 'Value must be greater than or equal to 0.'}
          ])

        next()
      })
    })

    it("amountDue must be numeric", function(next) {
      var invoice = chai.factory.create('invoice', connection, 
        {amountDue: 'abc'})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(1)
        expect(errors).to.deep.equal([ 
          {parameter: 'amountDue', value: 'abc', 
            message: 'Incorrect type. Expected number.'},
          ])

        next()
      })
    })

    it("amountDue must gt 0", function(next) {
      var invoice = chai.factory.create('invoice', connection, 
        {amountDue: -1})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(1)
        expect(errors).to.deep.equal([ 
          {parameter: 'amountDue', value: -1, 
            message: 'Value must be greater than or equal to 0.'}
          ])

        next()
      })
    })

    it("validates output address must be present", function(next) {
      var invoice = chai.factory.create('invoice', connection, 
        {receiverAddr: null})

      invoice.isValid(function(count, errors) {
        expect(count).to.equal(1)
        expect(errors).to.deep.equal([ 
          {parameter: 'receiverAddr', value: undefined, message: 'Required value.'} ])

        next()
      })
    })

    it("declaration must not be addressed to self", function(next) {
      chai.factory.create('invoice', connection, 
        {receiverAddr: globals.testerPublicKey}).save(globals.testerPrivateKey,
        function(err, create_invoice) {

        Invoice.find(connection, create_invoice.txid, function(err, find_invoice) {
          find_invoice.isValid(function(count, errors) {
            expect(count).to.equal(1)
            expect(errors).to.deep.equal([ {parameter: 'receiverAddr',
              value: globals.testerPublicKey, message: 'matches senderAddr'} ])

            next()
          })
        })
      })
    })

  })
})
