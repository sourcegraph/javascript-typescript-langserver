package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	//"runtime"
	"strconv"

	"./jsonrpc2"
	"./lsp"
)

var (
	addr       = flag.String("addr", "localhost:2088", "language server address (tcp)")
	rootPath   = flag.String("root-path", ".", "language server root path")
	file       = flag.String("file", "", "File")
	line 	   = flag.Int("line", 1, "Symbol line (1-based")
	column 	   = flag.Int("column", 1, "Symbol column (1-based")
	command    = flag.String("command", "initialize", "LSP command")
	query      = flag.String("query", "Object", "LSP command")
	limit 	   = flag.Int("limit", 100, "Symbol line (1-based")
)

var reqCounter = 0

func main() {
	flag.Parse()
	log.SetFlags(0)

	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	client, err := client()
	if err != nil {
		return err
	}
	defer client.Close()

    switch *command {
		case "initialize": initialize(client)
		case "definition": getDefinition(client)
		case "hover": getHover(client)
		case "references": getReferences(client)
		case "external-refs": getWorkspaceSymbols(client, "externals", 1000)
		case "exported-symbols": getWorkspaceSymbols(client, "exported", 1000)
		case "workspace-symbols-all": getWorkspaceSymbols(client, "", *limit)
		case "workspace-symbols": getWorkspaceSymbols(client, *query, *limit)
		case "global-refs": getGlobalRefs(client, "")
		case "shutdown": shutdown(client);
	}
    // initialize(client);
    // getDefinition(client);
	// getHover(client);
	return nil;
}

func initialize(client *jsonrpc2.Client) error {
// initialize server
	// note that RootPath should point to file path, not URI (at least Java binding expects it to be path)
	_, err := request(client, "initialize", lsp.InitializeParams{
		RootPath: *rootPath,
	})
	if err != nil {
		return err
	}
	return nil;
}

func shutdown(client *jsonrpc2.Client) error {
	_, err := request(client, "shutdown", nil);
	if err != nil {
		return err
	}
	return nil;
}

func getDefinition(client *jsonrpc2.Client) error {
	initialize(client);
	response, err := request(client, "textDocument/definition", lsp.TextDocumentPositionParams{
   		TextDocument: lsp.TextDocumentIdentifier{
   			URI: toUri(filepath.Join(*rootPath, *file)),
   		},
   		Position: lsp.Position{
   			Line:      *line,
   			Character: *column ,
   		},
   	})
   	if err != nil {
   		return err
   	}
   	var location []lsp.Location
   	if err := json.Unmarshal(*response.Result, &location); err != nil {
   		return err
   	}
   	for _, l := range location {
   		println(l.URI, l.Range.Start.Line, l.Range.Start.Character, l.Range.End.Line, l.Range.End.Character)
   	}
	return nil;

}

func getHover(client *jsonrpc2.Client) error {
	    initialize(client);
		response, err := request(client, "textDocument/hover", lsp.TextDocumentPositionParams{
   		TextDocument: lsp.TextDocumentIdentifier{
   			URI: toUri(filepath.Join(*rootPath, *file)),
   		},
   		Position: lsp.Position{
   			Line:      *line,
   			Character: *column ,
   		},
   	});

	if err != nil {
   		return err
   }
	println(*response.Result);
   	// var location []lsp.Location
   	// if err := json.Unmarshal(*response.Result, &location); err != nil {
   	// 	return err
   	// }
	return nil;
}

func getReferences(client *jsonrpc2.Client) error {
	  initialize(client);
		response, err := request(client, "textDocument/references", lsp.ReferenceParams{
		TextDocumentPositionParams: lsp.TextDocumentPositionParams{
   		TextDocument: lsp.TextDocumentIdentifier{
   			URI: toUri(filepath.Join(*rootPath, *file)),
   		},
   		Position: lsp.Position{
   			Line:      *line,
   			Character: *column ,
   		},
		}});
  if err != nil {
   		return err
   	}
  var location []lsp.Location
   	if err := json.Unmarshal(*response.Result, &location); err != nil {
   		return err
   	}
   	for _, l := range location {
   		println(l.URI, l.Range.Start.Line, l.Range.Start.Character, l.Range.End.Line, l.Range.End.Character)
   	}
  return nil;
}

func getWorkspaceSymbols(client *jsonrpc2.Client, query string, limit int) error {
	    initialize(client);
		response, err := request(client, "workspace/symbol", lsp.WorkspaceSymbolParams{
   		Query: query, 
		Limit: limit,
   	});

	if err != nil {
   		return err
   }
	println(*response.Result);
   	// var location []lsp.Location
   	// if err := json.Unmarshal(*response.Result, &location); err != nil {
   	// 	return err
   	// }
	return nil;
}

func getGlobalRefs(client *jsonrpc2.Client, query string) error {
	    initialize(client);
		response, err := request(client, "textDocument/global-refs", lsp.WorkspaceSymbolParams{
   		Query: query, 
   	});

	if err != nil {
   		return err
   }
	println(*response.Result);
   	// var location []lsp.Location
   	// if err := json.Unmarshal(*response.Result, &location); err != nil {
   	// 	return err
   	// }
	return nil;
}

// creates new JSON-RPC client and connects it to remote language server
func client() (*jsonrpc2.Client, error) {
	conn, err := net.Dial("tcp", *addr)
	if err != nil {
		return nil, err
	}
	return jsonrpc2.NewClient(conn), nil
}

// request performs JSON-RPC request using initialized client connection and waits for response.
// This function assembles JSON-RPC requests from method name and parameters, also it assigns unique identifiers to each request
func request(client *jsonrpc2.Client, method string, params interface{}) (*jsonrpc2.Response, error) {
	reqCounter++

	request := &jsonrpc2.Request{
		Method: method,
	}
	if (params != nil) {
      request.SetParams(params);
	}

	request.ID = strconv.Itoa(reqCounter)
	return client.RequestAndWaitForResponse(request)
}

// converts file path to URI file://(/)POSIX-style-path
func toUri(path string) string {
	prefix := "file:///"
	// if runtime.GOOS == "windows" {
	// 	prefix += "/"
	// }
	r, _ := filepath.Rel(*rootPath, path)
	return prefix + filepath.ToSlash(r)
}
