import { ENERGIA } from "./catalog/energia";
import { LOGICA } from "./catalog/logica";
import { MICROCONTROLADORES } from "./catalog/microcontroladores";
import { TEMPORIZADORES } from "./catalog/temporizadores";
import { TRANSISTORES } from "./catalog/transistores";
import type { SystemSpec } from "./spec";

export const SYSTEMS: SystemSpec[] = [...ENERGIA, ...TRANSISTORES, ...TEMPORIZADORES, ...LOGICA, ...MICROCONTROLADORES];

export const systemById = (id: string | undefined) => SYSTEMS.find((s) => s.id === id);
