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
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs_20
            typescript
            just
          ];

          shellHook = ''
            echo "⚡ TypeScript/Bun development environment"
            echo "Bun: $(bun --version)"
            echo "Node: $(node --version)"
            echo ""
            echo "Available commands:"
            echo "  just ci      - Run CI checks (typecheck, lint, format, test)"
            echo "  just dev     - Run development server"
            echo "  just test    - Run tests"
            echo "  just fmt     - Format code"
            echo "  just lint    - Run linter"
          '';
        };
        
        apps.ci = {
          type = "app";
          program = "${pkgs.writeShellScript "ci" ''
            export PATH="${pkgs.lib.makeBinPath [
              pkgs.bun
              pkgs.nodejs_20
            ]}:$PATH"
            
            exec ${./scripts/ci.sh}
          ''}";
        };
      });
}
