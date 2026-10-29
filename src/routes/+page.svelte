<script lang="ts">
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";

  $effect(() => {
    if (app.pronto) goto(app.perfil ? "/hoje" : "/perfis", { replaceState: true });
  });
</script>
