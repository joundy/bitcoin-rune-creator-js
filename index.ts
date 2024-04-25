import { Runestone, SpacedRune, Symbol } from "runestone-js";
import { U128, U32 } from "big-varuint-js";
import {
  initEccLib,
  opcodes,
  script,
  payments,
  networks,
  Psbt,
} from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

initEccLib(ecc);

// DEFINE the network
// please note, this script only tested on regtest & testnet
// *DO NOT USE script on mainnet/production without any concern DWYOR
const network = networks.regtest;

const ECpair = ECPairFactory(ecc);
// generate wif
// console.log(ECpair.makeRandom().toWIF())
const keypair = ECpair.fromWIF(
  "Kym6MbkzqMpvKTeTEreBLYk4UeHTEnwBDG5NnGd96aAm6G23Gcms",
);
const pubKeyXonly = keypair.publicKey.subarray(1, 33);

const RUNE_RECEIVE_VALUE = 600;

function createRune() {
  const spacedRune = SpacedRune.fromString("WET.GEDANG.ENAKKK");

  const runestone = new Runestone({
    edicts: [],
    pointer: new U32(0n),
    etching: {
      rune: spacedRune.rune,
      spacers: spacedRune.spacers,
      premine: new U128(1000_000n),
      symbol: Symbol.fromString("R"),
      terms: {
        amount: new U128(1000n),
        cap: new U128(100n),
      },
    },
  });

  const buffer = runestone.enchiper();

  return { buffer, commitBuffer: runestone.etching?.rune?.commitBuffer() };
}

function createMintPayment(commitBuffer: Buffer) {
  // example witness + text inscription
  // *commit buffer is required
  const ordinalStacks = [
    pubKeyXonly,
    opcodes.OP_CHECKSIG,
    opcodes.OP_FALSE,
    opcodes.OP_IF,
    Buffer.from("ord", "utf8"),
    1,
    1,
    Buffer.concat([Buffer.from("text/plain;charset=utf-8", "utf8")]),
    1,
    2,
    opcodes.OP_0,
    1,
    13,
    commitBuffer,
    opcodes.OP_0,
    Buffer.concat([Buffer.from("I LOVE MY MOM", "utf8")]),
    opcodes.OP_ENDIF,
  ];
  const ordinalScript = script.compile(ordinalStacks);

  const scriptTree = {
    output: ordinalScript,
  };

  const redeem = {
    output: ordinalScript,
    redeemVersion: 192,
  };

  const payment = payments.p2tr({
    internalPubkey: pubKeyXonly,
    network,
    scriptTree,
    redeem,
  });

  return {
    payment,
    redeem,
  };
}

function createPsbt(
  payment: payments.Payment,
  redeem: {
    output: Buffer;
    redeemVersion: number;
  },
  hash: string,
  index: number,
  satValue: number,
  receiverAddress: string,
  runeBuffer: Buffer,
) {
  const psbt = new Psbt({ network });
  psbt.addInput({
    hash,
    index,
    tapInternalKey: pubKeyXonly,
    witnessUtxo: {
      script: payment.output!,
      value: satValue,
    },
    tapLeafScript: [
      {
        leafVersion: redeem.redeemVersion,
        script: redeem.output,
        controlBlock: payment.witness![payment.witness!.length - 1],
      },
    ],
  });

  // this only used when then premine and pointer value is pointed to this index
  // otherwise this will become dust utxo
  // alternativaly you can just ignore this output if premine/pointer is not used.
  psbt.addOutput({
    address: receiverAddress,
    value: RUNE_RECEIVE_VALUE,
  });

  const runeScript = script.compile([
    opcodes.OP_RETURN,
    opcodes.OP_13,
    runeBuffer,
  ]);
  psbt.addOutput({
    script: runeScript,
    value: 0,
  });

  return psbt;
}

function calculateFee(
  payment: payments.Payment,
  redeem: {
    output: Buffer;
    redeemVersion: number;
  },
  receiverAddress: string,
  runeBuffer: Buffer,
) {
  // create dummy tx
  const tx = createPsbt(
    payment,
    redeem,
    "e2aa2f0e1b49567e3c5e2f5985898657930e9f3ec1580b38429499e318c62b64",
    0,
    10 * 10 ** 8, // 10btc, just for dummy
    receiverAddress,
    runeBuffer,
  );

  tx.signAllInputs(keypair);
  tx.finalizeAllInputs();
  const vSize = tx.extractTransaction(true).virtualSize();
  return vSize;
}

async function main() {
  // STEP 1, create payment address and fund the balance
  const rune = createRune();
  const payment = createMintPayment(rune.commitBuffer!);
  const receiverAddress =
    "bcrt1p7xs0js658s3h7k80uweszex7esm4eyds62nhjrf8mpggtkrk9ztstqjx46";

  const fee = calculateFee(
    payment.payment,
    payment.redeem,
    receiverAddress,
    rune.buffer,
  );
  const fundValue = fee + RUNE_RECEIVE_VALUE;
  console.log(
    `- please fund this address ${payment.payment.address} ${fundValue} sat`,
  );
  // *this is required due to the ORD server checker to prevent front running transactions.
  console.log(
    `- wait until >=6 block confirmation and then continue to step 2`,
  );

  // STEP 2, create mint transaction
  const txHash =
    "c19b0c847cb40187dafdce244b6c75f5e5dacdb362a2cd01bf59c6227be5cbde";
  const txIndex = 0;
  const psbt = createPsbt(
    payment.payment,
    payment.redeem,
    txHash,
    txIndex,
    fundValue,
    receiverAddress,
    rune.buffer,
  );
  psbt.signAllInputs(keypair);
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  console.log({ txHex });
}
main();
