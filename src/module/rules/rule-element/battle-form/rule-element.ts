import type { ActorType, CharacterPF2e } from "@actor";
import { CharacterStrike } from "@actor/character/data.ts";
import { SENSE_TYPES } from "@actor/creature/values.ts";
import { ActorInitiative } from "@actor/initiative.ts";
import { DamageDicePF2e, ModifierPF2e, StatisticModifier } from "@actor/modifiers.ts";
import { MOVEMENT_TYPES } from "@actor/values.ts";
import type { ImageFilePath } from "@common/constants.d.mts";
import { WeaponPF2e } from "@item";
import { RollNotePF2e } from "@module/notes.ts";
import { Predicate } from "@system/predication.ts";
import { RecordField } from "@system/schema-data-fields.ts";
import { ErrorPF2e, isObject, objectHasKey, setHasElement, sluggify, tupleHasValue } from "@util";
import * as R from "remeda";
import { RuleElementOptions, RuleElementPF2e } from "../base.ts";
import { CreatureSizeRuleElement } from "../creature-size.ts";
import { ModelPropsFromRESchema, ResolvableValueField, RuleElementSource } from "../data.ts";
import { ImmunityRuleElement } from "../iwr/immunity.ts";
import { ResistanceRuleElement } from "../iwr/resistance.ts";
import { WeaknessRuleElement } from "../iwr/weakness.ts";
import { SenseRuleElement } from "../sense.ts";
import { StrikeRuleElement } from "../strike.ts";
import { TempHPRuleElement } from "../temp-hp.ts";
import { BattleFormRuleOverrideSchema, BattleFormRuleSchema } from "./schema.ts";
import { BattleFormSource, BattleFormStrike, BattleFormStrikeQuery } from "./types.ts";
import fields = foundry.data.fields;

class BattleFormRuleElement extends RuleElementPF2e<BattleFormRuleSchema> {
    protected static override validActorTypes: ActorType[] = ["character"];

    /** The label given to modifiers of AC, skills, and strikes */
    modifierLabel: string = "invalid";

    constructor(data: BattleFormSource, options: RuleElementOptions) {
        super(data, options);
        if (this.invalid) return;

        this.overrides = this.resolveValue(
            this.value,
            this.overrides,
        ) as fields.ModelPropsFromSchema<BattleFormRuleOverrideSchema>;

        this.modifierLabel = this.getReducedLabel();
    }

    static override defineSchema(): BattleFormRuleSchema {
        return {
            ...super.defineSchema(),
            value: new ResolvableValueField({ required: false, initial: undefined }),
            overrides: new fields.SchemaField(
                {
                    traits: new fields.ArrayField(new fields.StringField()),
                    armorClass: new fields.SchemaField(
                        {
                            modifier: new ResolvableValueField({
                                required: false,
                                nullable: false,
                                initial: 0,
                            }),
                            ignoreCheckPenalty: new fields.BooleanField({
                                required: false,
                                nullable: false,
                                initial: true,
                            }),
                            ignoreSpeedPenalty: new fields.BooleanField({
                                required: false,
                                nullable: false,
                                initial: true,
                            }),
                            ownIfHigher: new fields.BooleanField({
                                required: false,
                                nullable: false,
                                initial: false,
                            }),
                        },
                        { required: false },
                    ),
                    tempHP: new ResolvableValueField({ required: false, nullable: true, initial: null }),
                    senses: new RecordField(
                        new fields.StringField({
                            required: true,
                            blank: false,
                            choices: () => ({
                                ...CONFIG.PF2E.senses,
                                ...R.mapKeys(CONFIG.PF2E.senses, (k) => sluggify(k, { camel: "dromedary" })),
                            }),
                        }),
                        new fields.SchemaField({
                            acuity: new fields.StringField({
                                choices: () => CONFIG.PF2E.senseAcuities,
                                required: false,
                                blank: false,
                                initial: undefined,
                            }),
                            range: new fields.NumberField({
                                required: false,
                                nullable: true,
                                positive: true,
                                integer: true,
                                initial: undefined,
                            }),
                        }),
                        { required: false, initial: () => ({}) },
                    ),
                    size: new fields.StringField({ required: false, blank: false, initial: undefined }),
                    speeds: new fields.ObjectField({ required: false, initial: () => ({}) }),
                    skills: new fields.ObjectField({ required: false, initial: () => ({}) }),
                    strikes: new fields.ObjectField({ required: false, initial: () => ({}) }),
                    immunities: new fields.ArrayField(new fields.ObjectField()),
                    weaknesses: new fields.ArrayField(new fields.ObjectField()),
                    resistances: new fields.ArrayField(new fields.ObjectField()),
                },
                { required: true, nullable: false },
            ),
            ownUnarmed: new fields.BooleanField({ required: false, nullable: false, initial: false }),
            canCast: new fields.BooleanField({ required: false, nullable: false, initial: false }),
            canSpeak: new fields.BooleanField({ required: false, nullable: false, initial: false }),
            hasHands: new fields.BooleanField({ required: false, nullable: false, initial: false }),
        };
    }

    static #defaultIcons: Record<string, ImageFilePath | undefined> = [
        "antler",
        "beak",
        "body",
        "bone-shard",
        "branch",
        "claw",
        "cube-face",
        "fangs",
        "fire-mote",
        "fist",
        "foot",
        "foreleg",
        "gust",
        "horn",
        "jaws",
        "lighting-lash",
        "mandibles",
        "piercing-hymn",
        "pincer",
        "pseudopod",
        "rock",
        "spikes",
        "stinger",
        "tail",
        "talon",
        "tendril",
        "tentacle",
        "tongue",
        "trunk",
        "tusk",
        "vine",
        "water-spout",
        "wave",
        "wing",
    ].reduce((accumulated: Record<string, ImageFilePath | undefined>, slug) => {
        const path =
            slug === "fist"
                ? "icons/skills/melee/unarmed-punch-fist.webp"
                : (`systems/pf2e/icons/unarmed-attacks/${slug}.webp` as const);
        return { ...accumulated, [slug]: path };
    }, {});

    override async preCreate({ itemSource, ruleSource }: RuleElementPF2e.PreCreateParams): Promise<void> {
        if (!this.test()) {
            ruleSource.ignored = true;
            return;
        }

        // Pre-clear other rule elements on this item as being compatible with the battle form
        const rules = (itemSource.system?.rules ?? []) as RuleElementSource[];
        for (const rule of rules) {
            if (["DamageDice", "FlatModifier", "Note"].includes(String(rule.key))) {
                const predicate = (rule.predicate ??= []);
                if (Array.isArray(predicate)) predicate.push("battle-form");
            }
        }

        // Look for strikes that are compendium weapon queries and construct using retrieved weapon
        await this.#resolveStrikeQueries(ruleSource);
    }

    /** Set temporary hit points */
    override onCreate(actorUpdates: Record<string, unknown>): void {
        if (this.ignored) return;

        const tempHP = this.overrides.tempHP;
        if (tempHP) {
            const source = { key: "TempHP", label: this.label, value: tempHP };
            new TempHPRuleElement(source, { parent: this.item }).onCreate(actorUpdates);
        }
    }

    override beforePrepareData(): void {
        if (this.ignored) return;

        const actor = this.actor;
        const attributes = actor.attributes;
        if (attributes.polymorphed) {
            this.ignored = true;
            return;
        }
        attributes.polymorphed = true;
        attributes.battleForm = true;

        this.#setRollOptions();
        this.#prepareSenses();
        if (this.ignored) return;

        for (const trait of this.overrides.traits) {
            const currentTraits = actor.system.traits;
            if (!currentTraits.value.includes(trait)) currentTraits.value.push(trait);
        }

        if (this.overrides.armorClass.ignoreSpeedPenalty) {
            const speedRollOptions = (actor.rollOptions.speed ??= {});
            speedRollOptions["armor:ignore-speed-penalty"] = true;
        }
    }

    override afterPrepareData(): void {
        if (this.ignored) return;

        this.#prepareAC();
        this.#prepareSize();
        this.#prepareSkills();
        this.#prepareSpeeds();
        this.#prepareStrikes();
        this.#prepareIWR();

        // Initiative is built from skills/perception, so re-initialize just in case
        const actor = this.actor;
        const initiativeData = actor.system.initiative;
        actor.initiative = new ActorInitiative(actor, R.pick(initiativeData, ["statistic", "tiebreakPriority"]));
        actor.system.initiative = actor.initiative.getTraceData();
    }

    /** Remove temporary hit points */
    override onDelete(actorUpdates: Record<string, unknown>): void {
        if (this.ignored) return;

        const tempHP = this.overrides.tempHP;
        if (tempHP) {
            const source = { key: "TempHP", label: this.label, value: tempHP };
            new TempHPRuleElement(source, { parent: this.item }).onDelete(actorUpdates);
        }
    }

    #setRollOptions(): void {
        const { attributes, rollOptions } = this.actor;
        rollOptions.all["polymorph"] = true;
        rollOptions.all["battle-form"] = true;
        if (this.overrides.armorClass.ignoreCheckPenalty) {
            rollOptions.all["armor:ignore-check-penalty"] = true;
        }
        if (this.overrides.armorClass.ignoreSpeedPenalty) {
            rollOptions.all["armor:ignore-speed-penalty"] = true;
            const speedRollOptions = (rollOptions.speed ??= {});
            speedRollOptions["armor:ignore-speed-penalty"] = true;
        }

        // Inform predicates that this battle form grants a skill modifier
        for (const key of Object.keys(this.overrides.skills)) {
            if (key in CONFIG.PF2E.skills) {
                rollOptions.all[`battle-form:${key}`] = true;
            }
        }

        // Reestablish hands free
        attributes.handsFree = Math.max(
            Object.values(this.overrides.strikes).reduce(
                (count, s) => (s.category === "unarmed" ? count : count - 1),
                2,
            ),
            0,
        );

        for (const num of [0, 1, 2]) {
            if (attributes.handsFree === num) {
                rollOptions.all[`hands-free:${num}`] = true;
            } else {
                delete rollOptions.all[`hands-free:${num}`];
            }
        }
    }

    /** Override the character's AC and ignore speed penalties if necessary */
    #prepareAC(): void {
        const { actor, overrides } = this;
        const armorClass = actor.armorClass;
        const acOverride = Number(this.resolveValue(overrides.armorClass.modifier, armorClass.value)) || 0;
        if (!acOverride) return;

        if (overrides.armorClass.ownIfHigher && armorClass.value > acOverride) return;

        this.#suppressModifiers(armorClass);
        const newModifier = (Number(this.resolveValue(overrides.armorClass.modifier)) || 0) - 10;
        armorClass.modifiers.push(new ModifierPF2e(this.modifierLabel, newModifier, "untyped"));
        actor.system.attributes.ac = fu.mergeObject(actor.system.attributes.ac, armorClass.parent.getTraceData());
    }

    /** Add new senses the character doesn't already have */
    #prepareSenses(): void {
        for (const [key, data] of Object.entries(this.overrides.senses)) {
            const slug = sluggify(key);
            if (!setHasElement(SENSE_TYPES, slug)) {
                this.failValidation(`senses: ${slug} is not a valid choice`);
                return;
            }
            const ruleData = { key: "Sense", selector: slug, force: true, ...data };
            new SenseRuleElement(ruleData, { parent: this.item }).beforePrepareData();
        }
    }

    /** Adjust the character's size category */
    #prepareSize(): void {
        if (!this.overrides.size) return;
        const ruleData = { key: "CreatureSize", label: this.label, value: this.overrides.size };
        new CreatureSizeRuleElement(ruleData, { parent: this.item }).beforePrepareData();
    }

    /** Add, replace and/or adjust non-land speeds */
    #prepareSpeeds(): void {
        const actor = this.actor;
        const attributes = actor.attributes;
        const currentSpeeds = attributes.speed;

        for (const movementType of MOVEMENT_TYPES) {
            const speedOverride = this.overrides.speeds[movementType];
            if (typeof speedOverride !== "number") continue;

            if (movementType === "land") {
                this.#suppressModifiers(attributes.speed);
                attributes.speed.value = speedOverride;
            } else {
                const otherSpeeds = currentSpeeds.otherSpeeds;
                const label = game.i18n.localize(CONFIG.PF2E.speedTypes[movementType]);
                otherSpeeds.findSplice((s) => s.type === movementType);
                otherSpeeds.push({ type: movementType, label, value: speedOverride });
                const newSpeed = actor.prepareSpeed(movementType);
                if (!newSpeed) throw ErrorPF2e("Unexpected failure retrieving movement type");
                this.#suppressModifiers(newSpeed);

                otherSpeeds.findSplice((s) => s.type === movementType);
                otherSpeeds.push(newSpeed);
            }
        }
    }

    #prepareSkills(): void {
        const actor = this.actor;
        for (const [key, newSkill] of Object.entries(this.overrides.skills)) {
            if (!objectHasKey(actor.skills, key)) {
                return this.failValidation(`Unrecognized skill: ${key}`);
            }
            newSkill.ownIfHigher ??= true;

            const currentSkill = actor.skills[key];
            const newModifier = Number(this.resolveValue(newSkill.modifier)) || 0;
            if (currentSkill.mod > newModifier && newSkill.ownIfHigher) {
                continue;
            }

            const baseMod = new ModifierPF2e({
                label: this.modifierLabel,
                slug: "battle-form",
                modifier: newModifier,
                type: "untyped",
            });

            actor.skills[key] = currentSkill.extend({ modifiers: [baseMod], filter: this.#filterModifier });
            actor.system.skills[key] = fu.mergeObject(actor.system.skills[key], actor.skills[key].getTraceData());
        }
    }

    /** Clear out existing strikes and replace them with the form's stipulated ones, if any */
    #prepareStrikes(): void {
        const actor = this.actor;
        const synthetics = actor.synthetics;
        const strikes = this.overrides.strikes;
        for (const strike of Object.values(strikes)) {
            strike.ownIfHigher ??= true;
        }

        const ruleData = Object.entries(strikes).map(([slug, strikeData]) => ({
            key: "Strike",
            label:
                game.i18n.localize(strikeData.label) ??
                `PF2E.BattleForm.Attack.${sluggify(slug, { camel: "bactrian" })}`,
            slug,
            predicate: strikeData.predicate ?? [],
            img: strikeData.img ?? BattleFormRuleElement.#defaultIcons[slug] ?? this.item.img,
            category: strikeData.category,
            group: strikeData.group,
            baseItem: strikeData.baseType,
            options: [slug],
            damage: { base: strikeData.damage },
            range: strikeData.range,
            traits: strikeData.traits ?? [],
            ability: strikeData.ability,
            battleForm: true,
        }));

        // Repopulate strikes with new WeaponPF2e instances--unless ownUnarmed is true
        const strikeRules = actor.rules.filter((r): r is StrikeRuleElement => r.key === "Strike");
        if (this.ownUnarmed) {
            for (const rule of strikeRules) {
                if (rule.category !== "unarmed") rule.ignored = true;
            }
            actor.rollOptions.all["battle-form:own-attack-modifier"] = true;
        } else {
            for (const rule of strikeRules) {
                if (!rule.battleForm) rule.ignored = true;
            }
            for (const striking of Object.values(synthetics.striking).flat()) {
                const predicate = (striking.predicate ??= new Predicate());
                predicate.push({ not: "battle-form" });
            }

            for (const datum of ruleData) {
                if (!datum.traits.includes("magical")) datum.traits.push("magical");
                new StrikeRuleElement(datum, { parent: this.item }).beforePrepareData();
            }
        }

        actor.system.actions = actor
            .prepareStrikes({ includeBasicUnarmed: this.ownUnarmed })
            .filter((a) => a.item.flags.pf2e.battleForm || (this.ownUnarmed && a.item.category === "unarmed"));
        const strikeActions = actor.system.actions.flatMap((s): CharacterStrike[] => [s, ...s.altUsages]);

        for (const action of strikeActions) {
            const strike = strikes[action.slug ?? ""];
            if (!strike) continue;
            const addend = action.modifiers
                .filter((m) => m.enabled && this.#filterModifier(m))
                .reduce((sum, m) => sum + m.modifier, 0);
            const formModifier = Number(this.resolveValue(strike.modifier)) + addend;
            if (!this.ownUnarmed && (formModifier >= action.totalModifier || !strike.ownIfHigher)) {
                // The battle form's static attack-roll modifier is >= the character's unarmed attack modifier:
                // replace inapplicable attack-roll modifiers with the battle form's
                this.#suppressModifiers(action);
                this.#suppressNotes(
                    Object.entries(synthetics.rollNotes).flatMap(([key, note]) => (/\bdamage\b/.test(key) ? note : [])),
                );
                const baseModifier = Number(this.resolveValue(strike.modifier)) || 0;
                action.unshift(new ModifierPF2e(this.modifierLabel, baseModifier, "untyped"));
            } else {
                const options = (actor.rollOptions["strike-attack-roll"] ??= {});
                options["battle-form:own-attack-modifier"] = true;
                action.calculateTotal(new Set(actor.getRollOptions(action.domains)));
            }
        }
    }

    /** Immunity, weakness, and resistance */
    #prepareIWR(): void {
        for (const immunity of this.overrides.immunities) {
            new ImmunityRuleElement({ key: "Immunity", ...immunity }, { parent: this.item }).afterPrepareData();
        }
        for (const weakness of this.overrides.weaknesses) {
            const args = { key: "Weakness", ...weakness, override: true };
            new WeaknessRuleElement(args, { parent: this.item }).afterPrepareData();
        }
        for (const resistance of this.overrides.resistances) {
            const args = { key: "Resistance", ...resistance, override: true };
            new ResistanceRuleElement(args, { parent: this.item }).afterPrepareData();
        }
    }

    /** Disable ineligible check modifiers */
    #suppressModifiers(statistic: { modifiers: readonly ModifierPF2e[] }): void {
        for (const modifier of statistic.modifiers) {
            if (!this.#filterModifier(modifier)) {
                modifier.adjustments.push({ slug: null, test: () => true, suppress: true });
                modifier.ignored = true;
                modifier.enabled = false;
            }
        }
        if (statistic instanceof StatisticModifier) {
            statistic.calculateTotal();
        }
    }

    #filterModifier(modifier: ModifierPF2e) {
        if (modifier.slug === "battle-form") return true;
        if (modifier.type === "ability") return false;
        return ["status", "circumstance"].includes(modifier.type) || modifier.modifier < 0;
    }

    #suppressNotes(notes: RollNotePF2e[]): void {
        for (const note of notes) {
            if (!note.predicate.includes("battle-form")) {
                note.predicate = note.predicate instanceof Predicate ? note.predicate : new Predicate(note.predicate);
                note.predicate.push({ not: "battle-form" });
            }
        }
    }

    /** Disable ineligible damage adjustments (modifiers, bonuses, additional damage) */
    override applyDamageExclusion(weapon: WeaponPF2e, modifiers: (DamageDicePF2e | ModifierPF2e)[]): void {
        if (this.ownUnarmed) return;

        for (const modifier of modifiers) {
            if (modifier.predicate.some((s) => s instanceof Object && "not" in s && s.not === "battle-form")) {
                continue;
            }

            const isNumericBonus = modifier instanceof ModifierPF2e && modifier.modifier >= 0;
            const isAbilityModifier = modifier instanceof ModifierPF2e && modifier.type === "ability";
            const isExtraDice = modifier instanceof DamageDicePF2e;
            const isStatusOrCircumstance = isNumericBonus && ["status", "circumstance"].includes(modifier.type);
            const isDamageTrait =
                isExtraDice &&
                /^(?:deadly|fatal)-\d?d\d{1,2}$/.test(modifier.slug) &&
                tupleHasValue(this.overrides?.strikes?.[weapon.slug ?? ""]?.traits ?? [], modifier.slug);
            const isBattleFormModifier = !!(
                modifier.predicate.includes("battle-form") ||
                modifier.predicate.some((s) => s instanceof Object && "or" in s && s.or.includes("battle-form")) ||
                isDamageTrait
            );

            if (
                (isNumericBonus || isAbilityModifier || isExtraDice) &&
                !isStatusOrCircumstance &&
                !isBattleFormModifier
            ) {
                modifier.enabled = false;
                modifier.ignored = true;
                modifier.predicate.push({ not: "battle-form" });
            }
        }
    }

    /** Process compendium query and construct full strike object using retrieved weapon */
    async #resolveStrikeQueries(
        ruleSource: RuleElementSource & { value?: JSONValue; overrides?: JSONValue },
    ): Promise<void> {
        const value = ruleSource.overrides ? ruleSource.overrides : (ruleSource.value ??= {});
        const hasStrikes = (v: unknown): v is ValueWithStrikes =>
            isObject<{ strikes: unknown }>(v) && isObject<Record<string, unknown>>(v.strikes);

        if (!hasStrikes(value)) return;

        const isStrikeQuery = (maybeQuery: unknown): maybeQuery is BattleFormStrikeQuery => {
            if (!isObject<BattleFormStrikeQuery>(maybeQuery)) return false;
            return typeof maybeQuery.query === "string" && typeof maybeQuery.modifier === "number";
        };

        for (const [slug, strike] of Object.entries(value.strikes)) {
            if (!isStrikeQuery(strike)) continue;

            strike.pack = String(strike.pack ?? "pf2e.equipment-srd");
            strike.ownIfHigher = !!(strike.ownIfHigher ?? true);

            const queryObject = ((): Record<string, unknown> | null => {
                try {
                    const parsed = JSON.parse(String(this.resolveInjectedProperties(strike.query)));
                    if (!isObject<Record<string, unknown>>(parsed) || Array.isArray(parsed)) {
                        throw Error("A strike query must be an NeDB query object");
                    }
                    return parsed;
                } catch (error) {
                    if (error instanceof Error) {
                        this.failValidation(error.message);
                    }
                    ruleSource.ignored = true;
                    return null;
                }
            })();
            if (!queryObject) {
                this.failValidation("Malformed query object");
                break;
            }

            const weapon = (await game.packs.get(strike.pack)?.getDocuments(queryObject))?.[0];
            if (!(weapon instanceof WeaponPF2e)) {
                this.failValidation("Failed to retrieve queried weapon");
                break;
            }

            const resolved: BattleFormStrike = {
                label: weapon.name,
                img: weapon.img,
                ability: weapon.isRanged || weapon.traits.has("finesse") ? "dex" : "str",
                category: weapon.category,
                group: weapon.group,
                baseType: weapon.baseType,
                traits: fu.deepClone(weapon.system.traits.value),
                modifier: strike.modifier,
                damage: fu.deepClone(weapon.system.damage),
                ownIfHigher: strike.ownIfHigher,
            };

            value.strikes[slug] = resolved;
        }
    }
}

interface BattleFormRuleElement
    extends RuleElementPF2e<BattleFormRuleSchema>,
        ModelPropsFromRESchema<BattleFormRuleSchema> {
    get actor(): CharacterPF2e;
}

interface ValueWithStrikes {
    strikes: Record<string, unknown>;
}

export { BattleFormRuleElement };
