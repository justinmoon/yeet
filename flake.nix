{
  description = "TypeScript/Bun project with CI setup";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        yeet = pkgs.writeShellScriptBin "yeet" ''
          exec ${pkgs.bun}/bin/bun run ${./src/index.ts} "$@"
        '';
      in
      {
        packages.default = yeet;
        packages.yeet = yeet;
        
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            typescript
            just
            biome
            
            # Testing - Playwright browsers
            playwright-driver.browsers
          ];
          
          # Tell Playwright to use Nix-provided browsers
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
        
        apps.ci = {
          type = "app";
          program = "${pkgs.writeShellScript "ci" ''
            export PATH="${pkgs.lib.makeBinPath [
              pkgs.bun
              pkgs.biome
            ]}:$PATH"
            
            # Tell Playwright to use Nix-provided browsers
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            
            exec ${./scripts/ci.sh}
          ''}";
        };
      });
}
