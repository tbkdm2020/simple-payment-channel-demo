import React from "react"
import { Card } from "antd"
import {
  searchLogs,
  getDepositValue,
  channelClosed,
  getWithdrawalBalance,
  verify,
  getExpireBlock,
} from "../Contract/Contract"
import { Withdraw } from "./Withdraw"
import { Deposit } from "./Deposit"
import { MakePayment } from "./MakePayment"
import { Claim } from "./Claim"

const _ = require("lodash")

export class ChannelInfo extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      myDepositValue: 0,
      bobDepositValue: 0,
      spend: 0,
      bobAddress: "",
      bobAddressHex: "",
      isOpening: false,
      currentBlock: 0,
      expireBlock: 0,
      qweb3: this.props.account.qweb3,
      withdrawalBalance: 0,
      latestPayment: { value: 0 },
    }

    this.fromBlock = 0
  }

  latestPaymentKey() {
    const { account, channelId } = this.props
    return `latest-payment-${account.contract.address}-${channelId}`
  }

  loadLatestPayment() {
    let latestPayment = window.localStorage.getItem(this.latestPaymentKey())
    if (latestPayment) {
      return JSON.parse(latestPayment)
    }
  }

  persistLatestPayment(payment) {
    window.localStorage.setItem(
      this.latestPaymentKey(),
      JSON.stringify(payment),
    )
  }

  latestSpendKey() {
    const { account, channelId } = this.props
    return `latest-spend-${account.contract.address}-${channelId}`
  }

  loadLatestSpend() {
    let latestSpend = window.localStorage.getItem(this.latestSpendKey())
    if (latestSpend) {
      return JSON.parse(latestSpend)
    }
  }

  persistLatestSpend(payment) {
    window.localStorage.setItem(this.latestSpendKey(), JSON.stringify(payment))
  }

  componentDidMount() {
    this.loadChannelInfo()

    const latestPayment = this.loadLatestPayment()
    if (latestPayment) {
      this.setState({ latestPayment })
    }

    let spend = 0
    let latestSpend = this.loadLatestSpend()
    if (latestSpend) {
      spend = latestSpend.value
      this.setState({ spend })
    }

    this.props.webSocket.addEventListener("message", (event) =>
      this.handleMessage(event),
    )
  }

  componentWillUnmount() {
    clearTimeout(this.timerID)
    this.timerID = undefined
  }

  async getCurrentBlock() {
    const info = await this.state.qweb3.getBlockchainInfo()
    // console.log(info)
    return info.blocks
  }

  async handleMessage(event) {
    const { account } = this.props
    const payment = JSON.parse(event.data)
    console.log("received payment info:", payment)
    if (!(await verify(account.contract, account.address, payment))) {
      alert("invalid payment")
      throw new Error("invalid payment")
    }

    let latestPayment = this.loadLatestPayment()
    if (!latestPayment || payment.value > latestPayment.value) {
      latestPayment = payment
    }

    this.persistLatestPayment(latestPayment)

    this.setState({ latestPayment })
  }

  async getBobInfo() {
    const { qweb3 } = this.state
    const { channelId, account } = this.props

    let logs = await searchLogs(qweb3, {
      fromBlock: this.fromBlock,
      toBlock: -1,
      addresses: [account.contract.address],
    })

    if (logs.length > 0) {
      this.fromBlock = logs[logs.length - 1].blockNumber + 1
    }

    logs = _.filter(logs, (log) => log.log.length > 0)
    logs = _.map(logs, (log) => {
      return log.log[0]
    })

    const makeChannelLogs = _.filter(
      logs,
      (log) => log._eventName === "LogChannel",
    )
    _.each(makeChannelLogs, async (l) => {
      const channelNum = parseInt(l.channelnum.toString(16), 16)
      if (channelNum !== parseInt(channelId, 10)) {
        return
      }

      let bobAddressHex
      if (l.bob === account.addressHex) {
        bobAddressHex = l.user
      } else if (l.user === account.addressHex) {
        bobAddressHex = l.bob
      } else {
        console.log(`you are neither Alice nor Bob of the channel ${channelId}`)
        return
      }

      const bobAddress = await qweb3.fromHexAddress(bobAddressHex)

      this.setState({
        bobAddressHex,
        bobAddress,
      })
    })
  }

  async loadChannelInfo() {
    const { channelId, account } = this.props
    const { bobAddressHex } = this.state
    const { contract, address, addressHex } = account

    const isOpening = !(await channelClosed(contract, channelId))
    const currentBlock = await this.getCurrentBlock()

    let bobDepositValue = 0
    if (bobAddressHex) {
      bobDepositValue = await getDepositValue(
        contract,
        bobAddressHex,
        channelId,
      )
    }
    const myDepositValue = await getDepositValue(
      contract,
      addressHex,
      channelId,
    )

    let withdrawalBalance = 0
    if (!isOpening) {
      withdrawalBalance = await getWithdrawalBalance(
        contract,
        address,
        channelId,
      )
    }
    const expireBlock = await getExpireBlock(contract, channelId)

    this.setState({
      currentBlock,
      bobDepositValue,
      myDepositValue,
      isOpening,
      withdrawalBalance,
      expireBlock,
    })

    this.timerID = setTimeout(async () => {
      if (!this.timerID) {
        return
      }
      await this.loadChannelInfo()
      await this.getBobInfo()
    }, 1000)
  }

  async onPayment(payment) {
    let latestSpend = this.loadLatestSpend()
    if (latestSpend && payment.value <= latestSpend.value) {
      throw new Error("invalid payment")
    }
    latestSpend = payment

    this.persistLatestSpend(latestSpend)
    this.setState({ spend: latestSpend.value })

    return this.props.webSocket.send(
      JSON.stringify({
        type: 1,
        data: payment,
      }),
    )
  }

  render() {
    const {
      myDepositValue,
      bobDepositValue,
      latestPayment,
      spend,
      bobAddress,
      bobAddressHex,
      isOpening,
      currentBlock,
      expireBlock,
    } = this.state
    const receivable = latestPayment.value
    return (
      <Card title={`channel id ${this.props.channelId}`} bordered={false}>
        <p>My deposit value: {myDepositValue / 1e8} QTUM</p>
        <p>
          My net balance: {(myDepositValue + receivable - spend) / 1e8} QTUM{" "}
          <span>(=myDepositValue + receivable - spend)</span>
        </p>
        <p>Counter-party deposit value: {bobDepositValue / 1e8} QTUM</p>
        <p>Receivable: {receivable / 1e8} QTUM</p>
        <p>Spend: {spend / 1e8} QTUM</p>
        <p>Counter-party address: {bobAddress}</p>
        <p>Counter-party hex address: {bobAddressHex}</p>
        <p>Is opening: {isOpening ? "Open" : "Closed"}</p>
        <p>Current block: {currentBlock}</p>
        <p>Expire block: {expireBlock}</p>

        <br />
        {this.renderButtons()}
      </Card>
    )
  }

  renderButtons() {
    const {
      isOpening,
      myDepositValue,
      spend,
      bobAddressHex,
      withdrawalBalance,
      latestPayment,
    } = this.state
    const { channelId, account } = this.props
    let btns
    if (isOpening) {
      btns = (
        <>
          <p>
            <Deposit account={account} channelId={channelId} />
          </p>
          <p>
            <MakePayment
              receivable={latestPayment.value}
              myDepositValue={myDepositValue}
              spend={spend}
              account={account}
              channelId={channelId}
              bobAddressHex={bobAddressHex}
              onPayment={(payment) => this.onPayment(payment)}
            />
          </p>
          <p>
            <Claim account={account} payment={latestPayment} />
          </p>
        </>
      )
    } else {
      btns = (
        <Withdraw
          withdrawalBalance={withdrawalBalance}
          account={account}
          channelId={channelId}
          payment={latestPayment}
        />
      )
    }
    return <div>{btns}</div>
  }
}
