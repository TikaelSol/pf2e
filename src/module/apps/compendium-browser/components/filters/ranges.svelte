<script lang="ts">
    import { slide } from "svelte/transition";
    import type { RangesInputData } from "../../tabs/data.ts";

    const { name, range = $bindable() }: { name: string; range: RangesInputData } = $props();

    function onChangeRange(event: Event & { currentTarget: HTMLInputElement }): void {
        const activeTab = game.pf2e.compendiumBrowser.activeTab;
        if (!activeTab) return;
        const elName = event.currentTarget.name;
        const elValue = event.currentTarget.value;
        if (elName === "lowerBound") {
            range.values = activeTab.parseRangeFilterInput(name, elValue, range.values.inputMax);
        } else if (elName === "upperBound") {
            range.values = activeTab.parseRangeFilterInput(name, range.values.inputMin, elValue);
        }
        range.changed = true;
    }
</script>

<div class="ranges-container" transition:slide>
    <div class="inputs">
        <input
            type="text"
            autocomplete="off"
            name="lowerBound"
            placeholder={range.defaultMin}
            bind:value={range.values.inputMin}
            onchange={onChangeRange}
        />
        -
        <input
            type="text"
            autocomplete="off"
            name="upperBound"
            placeholder={range.defaultMax}
            bind:value={range.values.inputMax}
            onchange={onChangeRange}
        />
    </div>
</div>

<style lang="scss">
    .ranges-container {
        display: flex;
        flex-direction: column;

        .inputs {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 0.5em;

            input {
                width: 45%;
            }
        }
    }
</style>
