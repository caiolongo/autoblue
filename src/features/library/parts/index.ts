import { port } from "./block";
import { CHIPS } from "./chips";
import { fuse, pushButton, slideSwitch } from "./controls";
import { MCU_PARTS } from "./mcus";
import { capacitor, inductor, potentiometer, resistor } from "./passives";
import { ams1117, reg7805 } from "./regulators";
import { diode, led, mosfet, npn } from "./semis";
import { battery9v, benchSupply, cellAA, usb5v } from "./sources";
import { SUPPORT } from "./support";
import { mosfetSmall, pnp } from "./transistors";
import type { PartDef, Props } from "./types";

/** Ordem em que aparecem na biblioteca. */
export const PART_LIST: PartDef[] = [
  battery9v,
  cellAA,
  usb5v,
  benchSupply,
  resistor,
  potentiometer,
  capacitor,
  inductor,
  led,
  diode,
  npn,
  pnp,
  mosfet,
  mosfetSmall,
  pushButton,
  slideSwitch,
  fuse,
  reg7805,
  ams1117,
  ...CHIPS,
  ...MCU_PARTS,
  ...SUPPORT,
  port,
];

export const PARTS: Record<string, PartDef> = Object.fromEntries(PART_LIST.map((d) => [d.kind, d]));

export function defaultProps(def: PartDef): Props {
  return Object.fromEntries(Object.entries(def.props).map(([k, d]) => [k, d.default]));
}

export type { PartDef, PinDef, PinRole, Marking, Props, PropDef, PropValue } from "./types";
