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
        
        # Built/frozen version - installed in nix store
        yeet-nix = pkgs.stdenv.mkDerivation {
          pname = "yeet-nix";
          version = "0.1.0";
          src = ./.;
          
          nativeBuildInputs = [ pkgs.bun ];
          
          buildPhase = ''
            export HOME=$TMPDIR
            bun install --frozen-lockfile
          '';
          
          installPhase = ''
            mkdir -p $out/share/yeet
            cp -r src node_modules package.json bun.lock $out/share/yeet/
            
            mkdir -p $out/bin
            cat > $out/bin/yeet-nix <<EOF
            #!${pkgs.bash}/bin/bash
            exec ${pkgs.bun}/bin/bun run $out/share/yeet/src/index.ts "\$@"
            EOF
            chmod +x $out/bin/yeet-nix
          '';
        };
        
        # Dev version - runs directly from ~/code/yeet
        yeet = pkgs.writeShellScriptBin "yeet" ''
          exec ${pkgs.bun}/bin/bun run "$HOME/code/yeet/src/index.ts" "$@"
        '';
      in
      {
        packages.default = yeet;
        packages.yeet = yeet;
        packages.yeet-nix = yeet-nix;
        
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            typescript
            just
            biome
            ripgrep
            
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
              pkgs.ripgrep
            ]}:$PATH"

            # Tell Playwright to use Nix-provided browsers
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            exec ${./scripts/ci.sh}
          ''}";
        };

        apps.pre-merge = {
          type = "app";
          program = "${pkgs.writeShellScript "pre-merge" ''
            set -e
            export PATH="${pkgs.lib.makeBinPath [
              pkgs.bun
              pkgs.biome
              pkgs.ripgrep
            ]}:$PATH"

            # Tell Playwright to use Nix-provided browsers
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            echo "Running pre-merge checks..."
            ${./scripts/ci.sh}
            echo "Pre-merge checks passed!"
          ''}";
        };
      });
}
